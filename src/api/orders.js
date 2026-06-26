const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { sendWhatsApp } = require('../helpers/whatsapp');

router.get('/', async (req, res) => {
  const vendorId = req.vendorId;
  const filter = req.query.filter || 'today';
  const page = parseInt(req.query.page) || 1;
  const limit = 30;
  const offset = (page - 1) * limit;

  let where = 'vendor_id = ?';
  const params = [vendorId];

  if (filter === 'today') where += ' AND DATE(created_at) = CURDATE()';
  else if (filter === 'waiting') where += " AND order_status = 'waiting'";
  else if (filter === 'active') where += " AND order_status IN ('waiting','confirmed','preparing','ready','out_for_delivery')";
  else if (filter === 'completed') where += " AND order_status IN ('delivered','cancelled')";

  const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM orders WHERE ${where}`, params);
  const [orders] = await db.query(
    `SELECT id, order_number, phone, customer_name, customer_phone, items, subtotal, delivery_charge, discount, gst, total,
            payment_method, payment_status, order_status, delivery_address, delivery_boy_id, created_at, coupon_code
     FROM orders WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  for (const o of orders) {
    o.items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
  }

  res.json({ orders, total, page, pages: Math.ceil(total / limit) });
});

router.get('/:id', async (req, res) => {
  const [[order]] = await db.query(
    'SELECT * FROM orders WHERE id=? AND vendor_id=?',
    [req.params.id, req.vendorId]
  );
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;

  if (order.delivery_boy_id) {
    const [[boy]] = await db.query('SELECT id, name, phone FROM delivery_boys WHERE id=?', [order.delivery_boy_id]);
    order.delivery_boy = boy || null;
  }

  res.json(order);
});

router.post('/:id/status', async (req, res) => {
  const vendorId = req.vendorId;
  const { status } = req.body;
  const validStatuses = ['waiting', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const [rows] = await db.query('SELECT * FROM orders WHERE id=? AND vendor_id=?', [req.params.id, vendorId]);
  if (!rows.length) return res.status(404).json({ error: 'Order not found' });
  const order = rows[0];

  await db.query('UPDATE orders SET order_status=? WHERE id=?', [status, order.id]);

  const msgVendorId = order.msg_vendor_id || vendorId;

  const [msgRows] = await db.query(
    'SELECT message FROM status_messages WHERE vendor_id=? AND status=? AND is_active=1',
    [vendorId, status]
  );
  if (msgRows.length) {
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    const itemsText = items.map(i => `• ${i.name} x${i.qty}`).join('\n');
    const restName = await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='restaurant_name'", [vendorId])
      .then(([r]) => r[0]?.setting_value || '');
    const eta = await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='estimated_time'", [vendorId])
      .then(([r]) => r[0]?.setting_value || '30-45');
    const reviewLink = await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='google_review_link'", [vendorId])
      .then(([r]) => r[0]?.setting_value || '');

    let msg = msgRows[0].message
      .replace(/{order_number}/g, order.order_number)
      .replace(/{name}/g, order.customer_name || 'Customer')
      .replace(/{items}/g, itemsText)
      .replace(/{total}/g, order.total)
      .replace(/{estimated_time}/g, eta)
      .replace(/{review_link}/g, reviewLink)
      .replace(/{restaurant_name}/g, restName)
      .replace(/{delivery_or_pickup}/g, order.delivery_address ? `📍 ${order.delivery_address}` : '🏃 Pickup');
    await sendWhatsApp(order.phone, msg, msgVendorId);
  }

  if (status === 'delivered') {
    const { isFeatureEnabled } = require('../helpers/store');
    const { getBillUrl } = require('../helpers/payment');
    const billEnabled = await isFeatureEnabled('bill_generation', vendorId);
    if (billEnabled && order.bill_token) {
      const billUrl = await getBillUrl(order.bill_token, vendorId);
      const reviewLink = await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='google_review_link'", [vendorId])
        .then(([r]) => r[0]?.setting_value || '');
      const billMsg =
        `🎉 *Order Delivered!*\n\nHi ${order.customer_name || 'there'}! Your order *#${order.order_number}* has been delivered.\n\n` +
        `🧾 *Your Bill:* ${billUrl}` +
        (reviewLink ? `\n\n⭐ *Rate us:* ${reviewLink}` : '') +
        `\n\nThank you for ordering! 🙏`;
      await sendWhatsApp(order.phone, billMsg, msgVendorId);
    }
    await db.query("UPDATE orders SET review_sent=1 WHERE id=?", [order.id]);
  }

  const io = req.app.get('io');
  if (io) io.to(`vendor_${vendorId}`).emit('order_updated', { orderId: order.id, status });

  res.json({ success: true, status });
});

router.post('/:id/accept', async (req, res) => {
  const vendorId = req.vendorId;
  const [rows] = await db.query('SELECT * FROM orders WHERE id=? AND vendor_id=? AND order_status="waiting"', [req.params.id, vendorId]);
  if (!rows.length) return res.status(404).json({ error: 'Order not found or already processed' });

  await db.query("UPDATE orders SET order_status='confirmed' WHERE id=?", [req.params.id]);

  const order = rows[0];
  const msgVendorId = order.msg_vendor_id || vendorId;
  const [msgRows] = await db.query("SELECT message FROM status_messages WHERE vendor_id=? AND status='confirmed' AND is_active=1", [vendorId]);
  if (msgRows.length) {
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    const itemsText = items.map(i => `• ${i.name} x${i.qty}`).join('\n');
    const restName = await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='restaurant_name'", [vendorId])
      .then(([r]) => r[0]?.setting_value || '');
    const eta = await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='estimated_time'", [vendorId])
      .then(([r]) => r[0]?.setting_value || '30-45');
    let msg = msgRows[0].message
      .replace(/{order_number}/g, order.order_number)
      .replace(/{name}/g, order.customer_name || 'Customer')
      .replace(/{items}/g, itemsText)
      .replace(/{total}/g, order.total)
      .replace(/{estimated_time}/g, eta)
      .replace(/{restaurant_name}/g, restName);
    await sendWhatsApp(order.phone, msg, msgVendorId);
  }

  const io = req.app.get('io');
  if (io) io.to(`vendor_${vendorId}`).emit('order_updated', { orderId: parseInt(req.params.id), status: 'confirmed' });

  res.json({ success: true });
});

router.post('/:id/reject', async (req, res) => {
  const vendorId = req.vendorId;
  const { reason } = req.body;
  const [rows] = await db.query('SELECT * FROM orders WHERE id=? AND vendor_id=? AND order_status="waiting"', [req.params.id, vendorId]);
  if (!rows.length) return res.status(404).json({ error: 'Order not found or already processed' });

  await db.query("UPDATE orders SET order_status='cancelled' WHERE id=?", [req.params.id]);

  const order = rows[0];
  const msgVendorId = order.msg_vendor_id || vendorId;
  const rejectMsg = `❌ *Order Cancelled*\n\nSorry ${order.customer_name || ''}, your order *#${order.order_number}* has been cancelled by the restaurant.\n\n${reason ? `📝 Reason: ${reason}\n\n` : ''}Please try again later. 🙏`;
  await sendWhatsApp(order.phone, rejectMsg, msgVendorId);

  const io = req.app.get('io');
  if (io) io.to(`vendor_${vendorId}`).emit('order_updated', { orderId: parseInt(req.params.id), status: 'cancelled' });

  res.json({ success: true });
});

router.post('/:id/assign-delivery', async (req, res) => {
  const vendorId = req.vendorId;
  const { delivery_boy_id } = req.body;
  const [orders] = await db.query('SELECT * FROM orders WHERE id=? AND vendor_id=?', [req.params.id, vendorId]);
  const [boys] = await db.query('SELECT * FROM delivery_boys WHERE id=? AND vendor_id=?', [delivery_boy_id, vendorId]);
  if (!orders.length || !boys.length) return res.status(404).json({ error: 'Not found' });

  await db.query('UPDATE orders SET delivery_boy_id=?, delivery_assigned_at=NOW() WHERE id=?', [delivery_boy_id, req.params.id]);

  const { sendDeliveryAssignment } = require('../helpers/delivery');
  await sendDeliveryAssignment(orders[0], boys[0], vendorId);

  res.json({ success: true });
});

router.post('/:id/mark-paid', async (req, res) => {
  await db.query("UPDATE orders SET payment_status='paid' WHERE id=? AND vendor_id=?", [req.params.id, req.vendorId]);
  res.json({ success: true });
});

module.exports = router;
