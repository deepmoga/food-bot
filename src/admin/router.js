const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { requireAuth } = require('./middleware/auth');
const { isFeatureEnabled } = require('../helpers/store');
const { sendWhatsApp } = require('../helpers/whatsapp');
const { sendDeliveryAssignment } = require('../helpers/delivery');
const { cartTotal } = require('../helpers/gst');
const { saveSetting, getSettings } = require('../helpers/settings');

// --- LOGIN ---
router.get('/login', (req, res) => res.render('admin/views/login', { error: null }));

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await db.query('SELECT * FROM vendors WHERE email = ? AND is_active = 1', [email]);
  if (!rows.length || !await bcrypt.compare(password, rows[0].password)) {
    return res.render('admin/views/login', { error: 'Invalid email or password.' });
  }
  req.session.vendorId = rows[0].id;
  req.session.vendorName = rows[0].name;
  res.redirect('/admin');
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// All routes below require auth
router.use(requireAuth);

// Helper to get enabled features for nav
async function getFeatures(vendorId) {
  const [rows] = await db.query('SELECT feature_key, is_enabled FROM vendor_features WHERE vendor_id = ?', [vendorId]);
  const map = {};
  for (const r of rows) map[r.feature_key] = r.is_enabled === 1;
  return map;
}

// --- ORDERS DASHBOARD ---
router.get('/', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const [deliveryBoys] = await db.query('SELECT * FROM delivery_boys WHERE vendor_id = ? AND is_active = 1', [vendorId]);

  const filter = req.query.filter || 'today';
  let where = 'vendor_id = ?';
  let params = [vendorId];
  if (filter === 'today') { where += ' AND DATE(created_at) = CURDATE()'; }
  else if (filter === 'pending') { where += " AND order_status = 'waiting'"; }
  else if (filter === 'cod') { where += " AND payment_method = 'cod'"; }
  else if (filter === 'paid') { where += " AND payment_status = 'paid'"; }

  const search = req.query.search || '';
  if (search) {
    where += ' AND (order_number LIKE ? OR customer_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const [orders] = await db.query(`SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT 100`, params);

  const [[stats]] = await db.query(`
    SELECT
      COUNT(CASE WHEN DATE(created_at)=CURDATE() THEN 1 END) as today_orders,
      COUNT(CASE WHEN order_status='waiting' THEN 1 END) as pending,
      SUM(CASE WHEN DATE(created_at)=CURDATE() AND order_status!='cancelled' THEN total ELSE 0 END) as today_revenue,
      SUM(CASE WHEN order_status!='cancelled' THEN total ELSE 0 END) as total_revenue
    FROM orders WHERE vendor_id = ?`, [vendorId]);

  res.render('admin/views/orders', { orders, stats, filter, search, deliveryBoys, features });
});

// --- API: Update Status ---
router.post('/api/update-status', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { order_id, status } = req.body;
  const [rows] = await db.query('SELECT * FROM orders WHERE id = ? AND vendor_id = ?', [order_id, vendorId]);
  if (!rows.length) return res.json({ success: false });
  const order = rows[0];

  await db.query('UPDATE orders SET order_status = ? WHERE id = ?', [status, order_id]);

  // Send WhatsApp template
  const [msgRows] = await db.query(
    'SELECT message FROM status_messages WHERE vendor_id = ? AND status = ? AND is_active = 1',
    [vendorId, status]
  );
  if (msgRows.length) {
    const items = JSON.parse(order.items);
    const itemsText = items.map(i => `• ${i.name} x${i.qty}`).join('\n');
    const reviewLink = (await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='google_review_link'", [vendorId]))[0][0]?.setting_value || '';
    const eta = (await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='estimated_time'", [vendorId]))[0][0]?.setting_value || '30-45';
    let msg = msgRows[0].message
      .replace(/{order_number}/g, order.order_number)
      .replace(/{name}/g, order.customer_name || 'Customer')
      .replace(/{items}/g, itemsText)
      .replace(/{total}/g, order.total)
      .replace(/{estimated_time}/g, eta)
      .replace(/{review_link}/g, reviewLink)
      .replace(/{delivery_or_pickup}/g, order.delivery_address ? `📍 ${order.delivery_address}` : '🏃 Pickup');
    await sendWhatsApp(order.phone, msg, vendorId);
  }

  res.json({ success: true });
});

// --- API: Mark COD Paid ---
router.post('/api/mark-paid', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { order_id } = req.body;
  await db.query("UPDATE orders SET payment_status='paid' WHERE id=? AND vendor_id=?", [order_id, vendorId]);
  res.json({ success: true });
});

// --- API: Assign Delivery ---
router.post('/api/assign-delivery', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { order_id, delivery_boy_id } = req.body;
  const [orders] = await db.query('SELECT * FROM orders WHERE id=? AND vendor_id=?', [order_id, vendorId]);
  const [boys] = await db.query('SELECT * FROM delivery_boys WHERE id=? AND vendor_id=?', [delivery_boy_id, vendorId]);
  if (!orders.length || !boys.length) return res.json({ success: false });

  await db.query('UPDATE orders SET delivery_boy_id=?, delivery_assigned_at=NOW() WHERE id=?', [delivery_boy_id, order_id]);
  await sendDeliveryAssignment(orders[0], boys[0], vendorId);
  res.json({ success: true });
});

// --- API: Stats ---
router.get('/api/stats', async (req, res) => {
  const vendorId = req.session.vendorId;
  const [[stats]] = await db.query(`
    SELECT
      COUNT(CASE WHEN DATE(created_at)=CURDATE() THEN 1 END) as today_orders,
      COUNT(CASE WHEN order_status='waiting' THEN 1 END) as pending,
      SUM(CASE WHEN DATE(created_at)=CURDATE() AND order_status!='cancelled' THEN total ELSE 0 END) as today_revenue,
      SUM(CASE WHEN order_status!='cancelled' THEN total ELSE 0 END) as total_revenue
    FROM orders WHERE vendor_id = ?`, [vendorId]);
  res.json(stats);
});

// --- API: New orders polling ---
router.get('/api/new-orders', async (req, res) => {
  const vendorId = req.session.vendorId;
  const since = parseInt(req.query.since) || 0;
  const [orders] = await db.query(
    "SELECT id, order_number, customer_name, total FROM orders WHERE vendor_id=? AND id>? AND order_status='waiting' ORDER BY id DESC",
    [vendorId, since]
  );
  res.json(orders);
});

router.get('/api/latest-order-id', async (req, res) => {
  const vendorId = req.session.vendorId;
  const [[row]] = await db.query('SELECT MAX(id) as maxId FROM orders WHERE vendor_id=?', [vendorId]);
  res.json({ id: row.maxId || 0 });
});

// --- API: Edit Order ---
router.post('/api/edit-order', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { order_id, items } = req.body;
  const parsedItems = JSON.parse(items);
  const subtotal = parsedItems.reduce((s, i) => s + i.price * i.qty, 0);
  const [orders] = await db.query('SELECT * FROM orders WHERE id=? AND vendor_id=?', [order_id, vendorId]);
  if (!orders.length) return res.json({ success: false });
  const o = orders[0];
  const total = subtotal - o.discount_amount + o.delivery_charge + o.gst_amount;
  await db.query('UPDATE orders SET items=?, subtotal=?, total=? WHERE id=?', [items, subtotal, total, order_id]);
  res.json({ success: true, total });
});

// --- MENU ---
router.get('/menu', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const [categories] = await db.query('SELECT * FROM categories WHERE vendor_id=? ORDER BY sort_order, name', [vendorId]);
  const [items] = await db.query('SELECT mi.*, c.name as cat_name FROM menu_items mi JOIN categories c ON c.id=mi.category_id WHERE mi.vendor_id=? ORDER BY c.sort_order, mi.name', [vendorId]);
  const [addons] = await db.query('SELECT ia.*, mi.name as item_name FROM item_addons ia JOIN menu_items mi ON mi.id=ia.item_id WHERE mi.vendor_id=? ORDER BY ia.sort_order', [vendorId]);
  res.render('admin/views/menu', { categories, items, addons, features });
});

router.post('/menu/category', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { action, id, name, emoji, sort_order } = req.body;
  if (action === 'add') await db.query('INSERT INTO categories (vendor_id,name,emoji,sort_order) VALUES (?,?,?,?)', [vendorId, name, emoji, sort_order || 0]);
  else if (action === 'edit') await db.query('UPDATE categories SET name=?,emoji=?,sort_order=? WHERE id=? AND vendor_id=?', [name, emoji, sort_order, id, vendorId]);
  else if (action === 'delete') await db.query('DELETE FROM categories WHERE id=? AND vendor_id=?', [id, vendorId]);
  else if (action === 'toggle') await db.query('UPDATE categories SET is_active=NOT is_active WHERE id=? AND vendor_id=?', [id, vendorId]);
  res.redirect('/admin/menu');
});

router.post('/menu/item', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { action, id, category_id, name, description, price } = req.body;
  if (action === 'add') await db.query('INSERT INTO menu_items (vendor_id,category_id,name,description,price) VALUES (?,?,?,?,?)', [vendorId, category_id, name, description, price]);
  else if (action === 'edit') await db.query('UPDATE menu_items SET category_id=?,name=?,description=?,price=? WHERE id=? AND vendor_id=?', [category_id, name, description, price, id, vendorId]);
  else if (action === 'delete') await db.query('DELETE FROM menu_items WHERE id=? AND vendor_id=?', [id, vendorId]);
  else if (action === 'toggle') await db.query('UPDATE menu_items SET is_available=NOT is_available WHERE id=? AND vendor_id=?', [id, vendorId]);
  res.redirect('/admin/menu');
});

router.post('/menu/addon', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { action, id, item_id, name, price } = req.body;
  if (action === 'add') await db.query('INSERT INTO item_addons (item_id,name,price) VALUES (?,?,?)', [item_id, name, price || 0]);
  else if (action === 'delete') await db.query('DELETE FROM item_addons WHERE id=? AND item_id IN (SELECT id FROM menu_items WHERE vendor_id=?)', [id, vendorId]);
  res.redirect('/admin/menu');
});

// --- DELIVERY BOYS ---
router.get('/delivery', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const [boys] = await db.query('SELECT * FROM delivery_boys WHERE vendor_id=? ORDER BY name', [vendorId]);
  res.render('admin/views/delivery', { boys, features });
});

router.post('/delivery', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { action, id, name, whatsapp_number } = req.body;
  if (action === 'add') await db.query('INSERT INTO delivery_boys (vendor_id,name,whatsapp_number) VALUES (?,?,?)', [vendorId, name, whatsapp_number]);
  else if (action === 'edit') await db.query('UPDATE delivery_boys SET name=?,whatsapp_number=? WHERE id=? AND vendor_id=?', [name, whatsapp_number, id, vendorId]);
  else if (action === 'delete') await db.query('DELETE FROM delivery_boys WHERE id=? AND vendor_id=?', [id, vendorId]);
  else if (action === 'toggle') await db.query('UPDATE delivery_boys SET is_active=NOT is_active WHERE id=? AND vendor_id=?', [id, vendorId]);
  res.redirect('/admin/delivery');
});

// --- COUPONS ---
router.get('/coupons', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const [coupons] = await db.query('SELECT * FROM coupons WHERE vendor_id=? ORDER BY id DESC', [vendorId]);
  res.render('admin/views/coupons', { coupons, features });
});

router.post('/coupons', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { action, id, code, type, value, min_order, max_discount, usage_limit, per_user_limit, expires_at, description } = req.body;
  if (action === 'add') {
    await db.query('INSERT INTO coupons (vendor_id,code,type,value,min_order,max_discount,usage_limit,per_user_limit,expires_at,description) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [vendorId, code.toUpperCase(), type, value, min_order||0, max_discount||0, usage_limit||0, per_user_limit||1, expires_at||null, description]);
  } else if (action === 'edit') {
    await db.query('UPDATE coupons SET code=?,type=?,value=?,min_order=?,max_discount=?,usage_limit=?,per_user_limit=?,expires_at=?,description=? WHERE id=? AND vendor_id=?',
      [code.toUpperCase(), type, value, min_order||0, max_discount||0, usage_limit||0, per_user_limit||1, expires_at||null, description, id, vendorId]);
  } else if (action === 'delete') await db.query('DELETE FROM coupons WHERE id=? AND vendor_id=?', [id, vendorId]);
  else if (action === 'toggle') await db.query('UPDATE coupons SET is_active=NOT is_active WHERE id=? AND vendor_id=?', [id, vendorId]);
  res.redirect('/admin/coupons');
});

// --- SETTINGS ---
router.get('/settings', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const settings = await getSettings(vendorId);
  res.render('admin/views/settings', { settings, features, query: req.query });
});

router.post('/settings', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { clearCache } = require('../helpers/settings');
  for (const [key, value] of Object.entries(req.body)) {
    await db.query('UPDATE settings SET setting_value=? WHERE vendor_id=? AND setting_key=?', [value, vendorId, key]);
  }
  clearCache(vendorId);
  res.redirect('/admin/settings?saved=1');
});

// --- STORE HOURS ---
router.get('/store-hours', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const [schedule] = await db.query('SELECT * FROM store_schedule WHERE vendor_id=? ORDER BY day_of_week', [vendorId]);
  const settings = await getSettings(vendorId);
  res.render('admin/views/store-hours', { schedule, settings, features, query: req.query });
});

router.post('/store-hours', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { clearCache } = require('../helpers/settings');
  const { store_open, days } = req.body;

  await db.query("UPDATE settings SET setting_value=? WHERE vendor_id=? AND setting_key='store_open'", [store_open||'0', vendorId]);

  if (days) {
    for (const [dow, data] of Object.entries(days)) {
      await db.query('UPDATE store_schedule SET is_open=?,open_time=?,close_time=? WHERE vendor_id=? AND day_of_week=?',
        [data.is_open||'0', data.open_time, data.close_time, vendorId, dow]);
    }
  }
  clearCache(vendorId);
  res.redirect('/admin/store-hours?saved=1');
});

// --- BILLS ---
router.get('/bills', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const [bills] = await db.query(
    'SELECT * FROM orders WHERE vendor_id=? AND bill_token IS NOT NULL ORDER BY id DESC LIMIT 200', [vendorId]);
  res.render('admin/views/bills', { bills, features });
});

module.exports = router;
