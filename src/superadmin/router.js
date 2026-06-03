const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { requireSuperAuth } = require('./middleware/auth');

const FEATURE_KEYS = ['coupon_system','online_payment','delivery_boys','gst','bill_generation','review_request','store_schedule'];
const FEATURE_LABELS = {
  coupon_system: '🏷️ Coupon System',
  online_payment: '💳 Online Payment',
  delivery_boys: '🛵 Delivery Boys',
  gst: '📊 GST',
  bill_generation: '🧾 Bill Generation',
  review_request: '⭐ Review Request',
  store_schedule: '🕐 Store Schedule'
};

// LOGIN
router.get('/login', (req, res) => res.render('superadmin/views/login', { error: null }));

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === process.env.SUPER_ADMIN_EMAIL && password === process.env.SUPER_ADMIN_PASS) {
    req.session.isSuperAdmin = true;
    return res.redirect('/superadmin');
  }
  res.render('superadmin/views/login', { error: 'Invalid credentials.' });
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/superadmin/login'); });

router.use(requireSuperAuth);

// DASHBOARD
router.get('/', async (req, res) => {
  const [vendors] = await db.query('SELECT v.*, (SELECT COUNT(*) FROM orders o WHERE o.vendor_id=v.id) as order_count, (SELECT COUNT(*) FROM orders o WHERE o.vendor_id=v.id AND DATE(o.created_at)=CURDATE()) as today_orders FROM vendors v ORDER BY v.id DESC');
  const [[globalStats]] = await db.query(`SELECT COUNT(*) as total_orders, SUM(total) as total_revenue FROM orders WHERE order_status != 'cancelled'`);
  res.render('superadmin/views/dashboard', { vendors, globalStats });
});

// VENDORS LIST
router.get('/vendors', async (req, res) => {
  const [vendors] = await db.query('SELECT * FROM vendors ORDER BY id DESC');
  const [subs] = await db.query('SELECT * FROM vendor_subscriptions');
  const subMap = {};
  for (const s of subs) subMap[s.vendor_id] = s;
  for (const v of vendors) v.sub = subMap[v.id] || null;
  res.render('superadmin/views/vendors', { vendors, error: null, success: null, query: req.query });
});

// CREATE VENDOR
router.post('/vendors/create', async (req, res) => {
  const { name, email, password, trial_messages } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.query('INSERT INTO vendors (name, email, password) VALUES (?,?,?)', [name, email, hashed]);
    const vendorId = result.insertId;
    await db.query('CALL setup_vendor_defaults(?)', [vendorId]);
    // Auto-generate unique verify token for this vendor
    const crypto = require('crypto');
    const uniqueVerifyToken = 'fb_verify_' + crypto.randomBytes(16).toString('hex');
    await db.query(
      "UPDATE settings SET setting_value=? WHERE vendor_id=? AND setting_key='verify_token'",
      [uniqueVerifyToken, vendorId]
    );
    // Create trial subscription with 50 free messages (or super admin's chosen amount)
    const trialCount = parseInt(trial_messages) || 50;
    // Trial expires in 1 month
    await db.query(
      `INSERT INTO vendor_subscriptions (vendor_id, plan_name, billing_type, messages_total, messages_used, start_date, end_date, status)
       VALUES (?, 'Trial', 'trial', ?, 0, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 'active')`,
      [vendorId, trialCount]
    );
    res.redirect('/superadmin/vendors?success=1');
  } catch (e) {
    const [vendors] = await db.query('SELECT * FROM vendors ORDER BY id DESC');
    res.render('superadmin/views/vendors', { vendors, error: 'Email already exists or error creating vendor.', success: null, query: {} });
  }
});

// TOGGLE VENDOR
router.post('/vendors/:id/toggle', async (req, res) => {
  await db.query('UPDATE vendors SET is_active=NOT is_active WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/vendors');
});

// DELETE VENDOR
router.post('/vendors/:id/delete', async (req, res) => {
  await db.query('DELETE FROM vendors WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/vendors');
});

// RESET PASSWORD
router.post('/vendors/:id/reset-password', async (req, res) => {
  const { new_password } = req.body;
  const hashed = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE vendors SET password=? WHERE id=?', [hashed, req.params.id]);
  res.redirect('/superadmin/vendors?success=1');
});

// FEATURES PAGE
router.get('/vendors/:id/features', async (req, res) => {
  const vendorId = req.params.id;
  const [vendors] = await db.query('SELECT * FROM vendors WHERE id=?', [vendorId]);
  if (!vendors.length) return res.redirect('/superadmin/vendors');

  const [featureRows] = await db.query('SELECT feature_key, is_enabled FROM vendor_features WHERE vendor_id=?', [vendorId]);
  const featureMap = {};
  for (const f of featureRows) featureMap[f.feature_key] = f.is_enabled === 1;

  res.render('superadmin/views/features', { vendor: vendors[0], featureMap, FEATURE_KEYS, FEATURE_LABELS, query: req.query });
});

router.post('/vendors/:id/features', async (req, res) => {
  const vendorId = req.params.id;
  for (const key of FEATURE_KEYS) {
    const enabled = req.body[key] === '1' ? 1 : 0;
    await db.query(
      'INSERT INTO vendor_features (vendor_id, feature_key, is_enabled) VALUES (?,?,?) ON DUPLICATE KEY UPDATE is_enabled=?',
      [vendorId, key, enabled, enabled]
    );
  }
  res.redirect(`/superadmin/vendors/${vendorId}/features?saved=1`);
});

// MANUAL TOP-UP — add messages to a vendor
router.post('/vendors/:id/topup', async (req, res) => {
  const vendorId = req.params.id;
  const { messages } = req.body;
  const count = parseInt(messages) || 0;
  if (count > 0) {
    // Upsert subscription if not exists
    await db.query(
      `INSERT INTO vendor_subscriptions (vendor_id, plan_name, billing_type, messages_total, messages_used, start_date, status)
       VALUES (?, 'Manual Top-up', 'trial', ?, 0, CURDATE(), 'active')
       ON DUPLICATE KEY UPDATE
         messages_total = messages_total + VALUES(messages_total),
         status = 'active',
         alert_80_sent = 0,
         alert_100_sent = 0`,
      [vendorId, count]
    );
  }
  res.redirect('/superadmin/vendors?success=1');
});

// PLATFORM SETTINGS
router.get('/settings', async (req, res) => {
  const { getPlatformSetting } = require('../helpers/platformSettings');
  const [rzpKeyId, rzpKeySecret, waToken] = await Promise.all([
    getPlatformSetting('platform_razorpay_key_id'),
    getPlatformSetting('platform_razorpay_key_secret'),
    getPlatformSetting('platform_whatsapp_token')
  ]);
  res.render('superadmin/views/settings', { rzpKeyId, rzpKeySecret, waToken, query: req.query });
});

router.post('/settings', async (req, res) => {
  const { setPlatformSetting, clearPlatformCache } = require('../helpers/platformSettings');
  const { platform_razorpay_key_id, platform_razorpay_key_secret, platform_whatsapp_token } = req.body;
  await Promise.all([
    setPlatformSetting('platform_razorpay_key_id', platform_razorpay_key_id || ''),
    setPlatformSetting('platform_razorpay_key_secret', platform_razorpay_key_secret || ''),
    setPlatformSetting('platform_whatsapp_token', platform_whatsapp_token || '')
  ]);
  clearPlatformCache();
  res.redirect('/superadmin/settings?saved=1');
});

// PLANS — list
router.get('/plans', async (req, res) => {
  const [plans] = await db.query('SELECT * FROM plans ORDER BY sort_order, id');
  res.render('superadmin/views/plans', { plans, query: req.query });
});

// PLANS — create
router.post('/plans/create', async (req, res) => {
  const { name, description, msg_count, price_monthly, price_yearly, sort_order } = req.body;
  await db.query(
    'INSERT INTO plans (name, description, msg_count, price_monthly, price_yearly, sort_order) VALUES (?,?,?,?,?,?)',
    [name, description, msg_count, price_monthly, price_yearly, sort_order || 0]
  );
  res.redirect('/superadmin/plans?success=1');
});

// PLANS — edit
router.post('/plans/:id/edit', async (req, res) => {
  const { name, description, msg_count, price_monthly, price_yearly, sort_order } = req.body;
  await db.query(
    'UPDATE plans SET name=?, description=?, msg_count=?, price_monthly=?, price_yearly=?, sort_order=? WHERE id=?',
    [name, description, msg_count, price_monthly, price_yearly, sort_order || 0, req.params.id]
  );
  res.redirect('/superadmin/plans?success=1');
});

// PLANS — toggle active
router.post('/plans/:id/toggle', async (req, res) => {
  await db.query('UPDATE plans SET is_active=NOT is_active WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/plans');
});

// PLANS — delete
router.post('/plans/:id/delete', async (req, res) => {
  await db.query('DELETE FROM plans WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/plans');
});

module.exports = router;
