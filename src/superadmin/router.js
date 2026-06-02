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
  res.render('superadmin/views/vendors', { vendors, error: null, success: null, query: req.query });
});

// CREATE VENDOR
router.post('/vendors/create', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const [result] = await db.query('INSERT INTO vendors (name, email, password) VALUES (?,?,?)', [name, email, hashed]);
    const vendorId = result.insertId;
    await db.query('CALL setup_vendor_defaults(?)', [vendorId]);
    res.redirect('/superadmin/vendors?success=1');
  } catch (e) {
    const [vendors] = await db.query('SELECT * FROM vendors ORDER BY id DESC');
    res.render('superadmin/views/vendors', { vendors, error: 'Email already exists or error creating vendor.', success: null });
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

module.exports = router;
