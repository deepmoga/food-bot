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

// Inject subscription into res.locals so all views can show usage bar
router.use(async (req, res, next) => {
  try {
    const { getSubscription } = require('../helpers/subscription');
    res.locals.subscription = await getSubscription(req.session.vendorId);
  } catch (_) {}
  next();
});

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

  // Calculate popular items (limit to active orders)
  const [popularRows] = await db.query(
    'SELECT items FROM orders WHERE vendor_id = ? AND order_status != "cancelled"',
    [vendorId]
  );
  const itemSales = {};
  for (const row of popularRows) {
    try {
      const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
      for (const item of items) {
        if (!itemSales[item.name]) {
          itemSales[item.name] = { name: item.name, qty: 0, revenue: 0 };
        }
        itemSales[item.name].qty += item.qty;
        const addonPrice = (item.addons || []).reduce((s, a) => s + (a.price || 0), 0);
        itemSales[item.name].revenue += (item.price + addonPrice) * item.qty;
      }
    } catch (_) {}
  }
  const popularItems = Object.values(itemSales)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  res.render('admin/views/orders', { orders, stats, filter, search, deliveryBoys, features, popularItems });
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
    await sendWhatsApp(order.phone, msg, vendorId);
  }

  // Bill send on 'delivered' status
  if (status === 'delivered') {
    const { isFeatureEnabled } = require('../helpers/store');
    const { getBillUrl } = require('../helpers/payment');
    const billEnabled = await isFeatureEnabled('bill_generation', vendorId);
    if (billEnabled && order.bill_token) {
      const billUrl = await getBillUrl(order.bill_token, vendorId);
      const reviewLink = (await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='google_review_link'", [vendorId]))[0][0]?.setting_value || '';
      const billMsg =
        `🎉 *Order Delivered!*\n\nHi ${order.customer_name || 'there'}! Your order *#${order.order_number}* has been delivered.\n\n` +
        `🧾 *Your Bill:* ${billUrl}` +
        (reviewLink ? `\n\n⭐ *Rate us:* ${reviewLink}` : '') +
        `\n\nThank you for ordering! 🙏`;
      await sendWhatsApp(order.phone, billMsg, vendorId);
    }
    await db.query("UPDATE orders SET review_sent=1 WHERE id=?", [order_id]);
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
  const total = subtotal - parseFloat(o.discount_amount) + parseFloat(o.delivery_charge) + parseFloat(o.gst_amount);
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
  const [variants] = await db.query('SELECT iv.*, mi.name as item_name FROM item_variants iv JOIN menu_items mi ON mi.id=iv.item_id WHERE mi.vendor_id=? ORDER BY iv.sort_order', [vendorId]);
  res.render('admin/views/menu', { categories, items, addons, variants, features });
});

router.post('/menu/variant', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { action, id, item_id, name, price } = req.body;
  if (action === 'add') {
    const [rows] = await db.query('SELECT id FROM menu_items WHERE id=? AND vendor_id=?', [item_id, vendorId]);
    if (rows.length) {
      await db.query('INSERT INTO item_variants (item_id, name, price) VALUES (?, ?, ?)', [item_id, name, price || 0]);
    }
  } else if (action === 'delete') {
    await db.query('DELETE FROM item_variants WHERE id=? AND item_id IN (SELECT id FROM menu_items WHERE vendor_id=?)', [id, vendorId]);
  }
  res.redirect('/admin/menu');
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

router.post('/menu/import', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.json({ success: false, error: 'Invalid or empty items data.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Fetch existing categories to map them and prevent duplicates
    const [existingCats] = await conn.query(
      'SELECT id, name FROM categories WHERE vendor_id = ?',
      [vendorId]
    );
    const catMap = {};
    existingCats.forEach(c => {
      catMap[c.name.toLowerCase().trim()] = c.id;
    });

    // Fetch existing menu items to prevent duplicate base items
    const [existingItems] = await conn.query(
      'SELECT id, category_id, name FROM menu_items WHERE vendor_id = ?',
      [vendorId]
    );
    const itemMap = {};
    existingItems.forEach(i => {
      itemMap[`${i.category_id}:${i.name.toLowerCase().trim()}`] = i.id;
    });

    for (const row of items) {
      let rawCat = String(row.Category || row.category || 'General').trim();
      const itemName = String(row['Item Name'] || row.itemName || row.name || '').trim();
      const description = String(row.Description || row.description || '').trim();
      const price = parseFloat(row.Price || row.price || 0);
      const availableVal = String(row.Available || row.available || 'Yes').trim().toLowerCase();
      const isAvailable = (availableVal === 'yes' || availableVal === '1' || availableVal === 'true') ? 1 : 0;

      if (!itemName) continue;

      // Extract emoji from Category if present
      let emoji = '';
      const emojiMatch = rawCat.match(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]/u);
      if (emojiMatch) {
        emoji = emojiMatch[0];
        rawCat = rawCat.replace(emoji, '').trim();
      }

      const catKey = rawCat.toLowerCase();
      let catId = catMap[catKey];

      if (!catId) {
        const [catResult] = await conn.query(
          'INSERT INTO categories (vendor_id, name, emoji, sort_order) VALUES (?, ?, ?, 0)',
          [vendorId, rawCat, emoji]
        );
        catId = catResult.insertId;
        catMap[catKey] = catId;
      }

      const itemKey = `${catId}:${itemName.toLowerCase()}`;
      let itemId = itemMap[itemKey];

      if (!itemId) {
        const [itemResult] = await conn.query(
          'INSERT INTO menu_items (vendor_id, category_id, name, description, price, is_available) VALUES (?, ?, ?, ?, ?, ?)',
          [vendorId, catId, itemName, description, price, isAvailable]
        );
        itemId = itemResult.insertId;
        itemMap[itemKey] = itemId;
      }

      // If variant is present, insert it
      const variantName = String(row.Variant || row.variant || row.Size || row.size || '').trim();
      if (variantName) {
        await conn.query(
          'INSERT INTO item_variants (item_id, name, price, is_active) VALUES (?, ?, ?, 1)',
          [itemId, variantName, price]
        );
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    console.error('[Menu Import] Error:', e.message);
    res.json({ success: false, error: e.message });
  } finally {
    conn.release();
  }
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
  res.render('admin/views/settings', { settings, features, vendorId, query: req.query });
});

router.post('/settings', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { clearCache } = require('../helpers/settings');
  for (const [key, value] of Object.entries(req.body)) {
    await db.query(
      `INSERT INTO settings (vendor_id, setting_key, setting_value) 
       VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [vendorId, key, value, value]
    );
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

// --- SUBSCRIPTION ---
router.get('/subscription', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const { getSubscription } = require('../helpers/subscription');
  const sub = await getSubscription(vendorId);
  const [plans] = await db.query('SELECT * FROM plans WHERE is_active=1 ORDER BY sort_order, id');
  const [payments] = await db.query(
    'SELECT * FROM subscription_payments WHERE vendor_id=? ORDER BY id DESC LIMIT 20',
    [vendorId]
  );
  const { getPlatformSetting } = require('../helpers/platformSettings');
  const razorpayKeyId = await getPlatformSetting('platform_razorpay_key_id');
  res.render('admin/views/subscription', { sub, plans, payments, features, razorpayKeyId, query: req.query });
});

// Create Razorpay order for plan purchase
router.post('/subscription/create-order', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { plan_id, billing_type } = req.body;
  if (!['monthly', 'yearly'].includes(billing_type)) return res.json({ error: 'Invalid billing type' });

  const [[plan]] = await db.query('SELECT * FROM plans WHERE id=? AND is_active=1', [plan_id]);
  if (!plan) return res.json({ error: 'Plan not found' });

  const amount = billing_type === 'yearly' ? plan.price_yearly : plan.price_monthly;
  const messagesAdded = billing_type === 'yearly' ? plan.msg_count * 12 : plan.msg_count;

  const { getPlatformSetting } = require('../helpers/platformSettings');
  const rzpKeyId = await getPlatformSetting('platform_razorpay_key_id');
  const rzpKeySecret = await getPlatformSetting('platform_razorpay_key_secret');
  if (!rzpKeyId || !rzpKeySecret) return res.json({ error: 'Payment gateway not configured. Contact administrator.' });

  const Razorpay = require('razorpay');
  const rzp = new Razorpay({ key_id: rzpKeyId, key_secret: rzpKeySecret });

  try {
    const rzpOrder = await rzp.orders.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      notes: { vendor_id: String(vendorId), plan_id: String(plan_id), billing_type }
    });

    const [result] = await db.query(
      `INSERT INTO subscription_payments (vendor_id, plan_id, plan_name, billing_type, messages_added, amount, razorpay_order_id, status)
       VALUES (?,?,?,?,?,?,?,'pending')`,
      [vendorId, plan.id, plan.name, billing_type, messagesAdded, amount, rzpOrder.id]
    );

    res.json({
      order_id: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: 'INR',
      key_id: rzpKeyId,
      plan_name: `${plan.name} (${billing_type})`,
      payment_id: result.insertId
    });
  } catch (e) {
    console.error('[Subscription] Razorpay create order error:', e.message);
    res.json({ error: 'Payment gateway error. Try again.' });
  }
});

// Verify payment and activate subscription
router.post('/subscription/verify', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, payment_id } = req.body;

  const crypto = require('crypto');
  const { getPlatformSetting } = require('../helpers/platformSettings');
  const secret = await getPlatformSetting('platform_razorpay_key_secret');
  const expected = crypto.createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    return res.json({ success: false, error: 'Payment verification failed' });
  }

  const [[payment]] = await db.query(
    'SELECT * FROM subscription_payments WHERE id=? AND vendor_id=? AND status="pending"',
    [payment_id, vendorId]
  );
  if (!payment) return res.json({ success: false, error: 'Payment record not found' });

  await db.query(
    'UPDATE subscription_payments SET status="paid", razorpay_payment_id=? WHERE id=?',
    [razorpay_payment_id, payment_id]
  );

  // Calculate end_date
  const now = new Date();
  let endDate;
  if (payment.billing_type === 'monthly') {
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  } else {
    endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  }
  const endDateStr = endDate.toISOString().split('T')[0];

  // Upsert subscription — reset messages for new period (no carry-forward)
  await db.query(
    `INSERT INTO vendor_subscriptions
      (vendor_id, plan_id, plan_name, billing_type, messages_total, messages_used, start_date, end_date, status, alert_80_sent, alert_100_sent)
     VALUES (?,?,?,?,?,0,CURDATE(),?,'active',0,0)
     ON DUPLICATE KEY UPDATE
       plan_id=VALUES(plan_id), plan_name=VALUES(plan_name), billing_type=VALUES(billing_type),
       messages_total=VALUES(messages_total), messages_used=0,
       start_date=CURDATE(), end_date=VALUES(end_date), status='active',
       alert_80_sent=0, alert_100_sent=0`,
    [vendorId, payment.plan_id, payment.plan_name, payment.billing_type, payment.messages_added, endDateStr]
  );

  res.json({ success: true });
});

// --- BROADCAST ---
router.get('/broadcast', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const { countRecipients } = require('../helpers/broadcast');

  const [[credRow]] = await db.query(
    'SELECT COALESCE(balance,0) as balance FROM broadcast_credits WHERE vendor_id=?', [vendorId]
  );
  const credits = credRow?.balance || 0;

  const [approvedTemplates] = await db.query(
    "SELECT * FROM broadcast_templates WHERE status='approved' ORDER BY display_name"
  );

  const [campaigns] = await db.query(
    'SELECT bc.*, bt.display_name as template_name FROM broadcast_campaigns bc LEFT JOIN broadcast_templates bt ON bt.id=bc.template_id WHERE bc.vendor_id=? ORDER BY bc.id DESC LIMIT 20',
    [vendorId]
  );

  const recipientCounts = {
    all: await countRecipients(vendorId, 'all'),
    last_30: await countRecipients(vendorId, 'last_30'),
    last_7: await countRecipients(vendorId, 'last_7'),
    last_3months: await countRecipients(vendorId, 'last_3months'),
    ordered_3plus: await countRecipients(vendorId, 'ordered_3plus'),
    custom: (req.session.customBroadcastPhones || []).length
  };

  res.render('admin/views/broadcast', { features, credits, approvedTemplates, campaigns, recipientCounts, query: req.query });
});

router.post('/broadcast/send', async (req, res) => {
  const vendorId = req.session.vendorId;
  const { template_id, recipient_filter, image_url } = req.body;

  try {
    const [[tpl]] = await db.query("SELECT * FROM broadcast_templates WHERE id=? AND status='approved'", [template_id]);
    if (!tpl) return res.redirect('/admin/broadcast?error=Template+not+found');

    const [[credRow]] = await db.query('SELECT COALESCE(balance,0) as balance FROM broadcast_credits WHERE vendor_id=?', [vendorId]);
    const credits = credRow?.balance || 0;

    const { countRecipients, getRecipients } = require('../helpers/broadcast');
    let recipientCount = 0;
    let customPhones = null;

    if (recipient_filter === 'custom') {
      customPhones = (req.session.customBroadcastPhones || []).join(',');
      recipientCount = (req.session.customBroadcastPhones || []).length;
    } else {
      recipientCount = await countRecipients(vendorId, recipient_filter || 'all');
    }

    if (recipientCount > credits) {
      return res.redirect('/admin/broadcast?error=' + encodeURIComponent('Enough credits nahi hain. ' + recipientCount + ' credits chahiye, ' + credits + ' available hain.'));
    }

    // Collect variable values
    const vars = JSON.parse(tpl.variables_json || '[]');
    const variableValues = vars.map((_, i) => req.body[`var_${i}`] || '');

    // Create campaign record
    const [result] = await db.query(
      `INSERT INTO broadcast_campaigns (vendor_id, template_id, template_name, variable_values, recipient_phones, image_url, recipient_filter, recipient_count, credits_used, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`,
      [vendorId, tpl.id, tpl.display_name, JSON.stringify(variableValues), customPhones, image_url || null, recipient_filter || 'all', recipientCount, recipientCount]
    );
    const campaignId = result.insertId;

    // Deduct credits immediately
    await db.query(
      'UPDATE broadcast_credits SET balance=balance-?, total_used=total_used+? WHERE vendor_id=?',
      [recipientCount, recipientCount, vendorId]
    );

    // Run campaign in background (don't await)
    const { runCampaign } = require('../helpers/broadcast');
    runCampaign(campaignId).catch(e => console.error('[Broadcast] Campaign error:', e.message));

    res.redirect('/admin/broadcast?success=1');
  } catch (e) {
    res.redirect('/admin/broadcast?error=' + encodeURIComponent(e.message));
  }
});

// --- BILLS ---
router.get('/bills', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const [bills] = await db.query(
    'SELECT * FROM orders WHERE vendor_id=? AND bill_token IS NOT NULL ORDER BY id DESC LIMIT 200', [vendorId]);
  res.render('admin/views/bills', { bills, features });
});

// --- CUSTOMERS ---
router.get('/customers', async (req, res) => {
  const vendorId = req.session.vendorId;
  const features = await getFeatures(vendorId);
  const filter = req.query.filter || '3months';
  const search = req.query.search || '';

  let where = 's.vendor_id = ?';
  let params = [vendorId];

  if (filter === '3months') {
    where += ' AND s.updated_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)';
  }

  if (search) {
    where += ' AND (s.customer_name LIKE ? OR s.phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const [customers] = await db.query(
    `SELECT 
       s.phone,
       COALESCE(s.customer_name, '') as name,
       COALESCE(s.customer_phone, s.phone) as customer_phone,
       COUNT(o.id) as order_count,
       COALESCE(SUM(o.total), 0) as total_spent,
       COALESCE(MAX(o.created_at), s.updated_at) as last_activity
     FROM sessions s
     LEFT JOIN orders o ON o.phone = s.phone AND o.vendor_id = s.vendor_id AND o.order_status != 'cancelled'
     WHERE ${where}
     GROUP BY s.phone, s.customer_name, s.customer_phone, s.updated_at
     ORDER BY order_count DESC, total_spent DESC, last_activity DESC
     LIMIT 200`,
    params
  );

  res.render('admin/views/customers', { customers, filter, search, features });
});

// --- API: Select Broadcast Recipients ---
router.post('/api/select-recipients', (req, res) => {
  const { phones } = req.body;
  req.session.customBroadcastPhones = Array.isArray(phones) ? phones : [];
  res.json({ success: true, count: req.session.customBroadcastPhones.length });
});

module.exports = router;
