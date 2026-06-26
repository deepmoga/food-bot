const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { generateToken, authMiddleware } = require('./middleware');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const [rows] = await db.query('SELECT * FROM vendors WHERE email = ? AND is_active = 1', [email]);
  if (!rows.length || !await bcrypt.compare(password, rows[0].password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const vendor = rows[0];
  const token = generateToken(vendor);

  const restName = await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='restaurant_name'", [vendor.id])
    .then(([r]) => r[0]?.setting_value || vendor.name);

  res.json({
    token,
    vendor: {
      id: vendor.id,
      name: vendor.name,
      email: vendor.email,
      restaurant_name: restName
    }
  });
});

router.post('/push-token', authMiddleware, async (req, res) => {
  const { token: pushToken, device } = req.body;
  if (!pushToken) return res.status(400).json({ error: 'Token required' });
  await db.query(
    'INSERT IGNORE INTO vendor_push_tokens (vendor_id, push_token, device_info) VALUES (?,?,?)',
    [req.vendorId, pushToken, device || null]
  );
  res.json({ success: true });
});

router.delete('/push-token', authMiddleware, async (req, res) => {
  const { token: pushToken } = req.body;
  if (pushToken) {
    await db.query('DELETE FROM vendor_push_tokens WHERE vendor_id=? AND push_token=?', [req.vendorId, pushToken]);
  }
  res.json({ success: true });
});

router.get('/me', authMiddleware, async (req, res) => {
  const [[vendor]] = await db.query('SELECT id, name, email, is_active FROM vendors WHERE id=?', [req.vendorId]);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

  const restName = await db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='restaurant_name'", [vendor.id])
    .then(([r]) => r[0]?.setting_value || vendor.name);

  res.json({ ...vendor, restaurant_name: restName });
});

module.exports = router;
