const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendWhatsApp, getCustomerMessagingVendorId } = require('../helpers/whatsapp');

// GET - Login screen
router.get('/login', async (req, res) => {
  try {
    const [vendors] = await db.query('SELECT id, name FROM vendors WHERE is_active = 1 ORDER BY name');
    res.render('kitchen/views/login', { vendors, error: null });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// POST - Login verify
router.post('/login', async (req, res) => {
  const { vendor_id, passcode } = req.body;
  try {
    const [vendors] = await db.query('SELECT id, name FROM vendors WHERE is_active = 1 ORDER BY name');
    
    const [rows] = await db.query(
      "SELECT setting_value FROM settings WHERE vendor_id = ? AND setting_key = 'kitchen_passcode'",
      [vendor_id]
    );

    if (rows.length && rows[0].setting_value === passcode.trim()) {
      req.session.kitchenVendorId = parseInt(vendor_id);
      return res.redirect('/kitchen');
    }

    res.render('kitchen/views/login', { vendors, error: 'Invalid passcode.' });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// GET - Logout
router.get('/logout', (req, res) => {
  req.session.kitchenVendorId = null;
  res.redirect('/kitchen/login');
});

// GET - KDS Screen (supports direct auto-login via URL params)
router.get('/', async (req, res) => {
  let vendorId = req.session.kitchenVendorId;
  const { vendor_id, passcode } = req.query;

  if (vendor_id && passcode) {
    const [rows] = await db.query(
      "SELECT setting_value FROM settings WHERE vendor_id = ? AND setting_key = 'kitchen_passcode'",
      [vendor_id]
    );
    if (rows.length && rows[0].setting_value === passcode.trim()) {
      req.session.kitchenVendorId = parseInt(vendor_id);
      vendorId = parseInt(vendor_id);
    }
  }

  if (!vendorId) {
    return res.redirect('/kitchen/login');
  }

  try {
    const [vRows] = await db.query('SELECT name FROM vendors WHERE id = ?', [vendorId]);
    const restaurantName = vRows.length ? vRows[0].name : 'Kitchen';
    res.render('kitchen/views/kds', { vendorId, restaurantName });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// GET - API: Active Orders list
router.get('/api/orders', async (req, res) => {
  const vendorId = req.session.kitchenVendorId;
  if (!vendorId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const [orders] = await db.query(
      `SELECT id, order_number, customer_name, items, order_status, created_at 
       FROM orders 
       WHERE vendor_id = ? AND order_status IN ('waiting', 'confirmed', 'preparing') AND DATE(created_at) = CURDATE()
       ORDER BY id ASC`,
      [vendorId]
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - API: Update Status & Notify WhatsApp
router.post('/api/update-status', async (req, res) => {
  const vendorId = req.session.kitchenVendorId;
  if (!vendorId) return res.status(401).json({ error: 'Unauthorized' });

  const { order_id, status } = req.body;
  if (!['preparing', 'ready'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM orders WHERE id = ? AND vendor_id = ?', [order_id, vendorId]);
    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = rows[0];

    await db.query('UPDATE orders SET order_status = ? WHERE id = ?', [status, order_id]);

    // Send WhatsApp status notification
    const [msgRows] = await db.query(
      'SELECT message FROM status_messages WHERE vendor_id = ? AND status = ? AND is_active = 1',
      [vendorId, status]
    );
    if (msgRows.length) {
      const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
      const itemsText = items.map(i => `• ${i.name} x${i.qty}`).join('\n');
      const reviewLink = (await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='google_review_link'", [vendorId]))[0][0]?.setting_value || '';
      const eta = (await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='estimated_time'", [vendorId]))[0][0]?.setting_value || '30-45';
      const restName = (await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='restaurant_name'", [vendorId]))[0][0]?.setting_value || '';

      let msg = msgRows[0].message
        .replace(/{order_number}/g, order.order_number)
        .replace(/{name}/g, order.customer_name || 'Customer')
        .replace(/{items}/g, itemsText)
        .replace(/{total}/g, order.total)
        .replace(/{estimated_time}/g, eta)
        .replace(/{review_link}/g, reviewLink)
        .replace(/{restaurant_name}/g, restName)
        .replace(/{delivery_or_pickup}/g, order.delivery_address ? `📍 ${order.delivery_address}` : '🏃 Pickup');

      const msgVendorId = await getCustomerMessagingVendorId(order.phone, vendorId);
      await sendWhatsApp(order.phone, msg, msgVendorId);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[KDS Update Status] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
