const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/status', async (req, res) => {
  const { isStoreOpen } = require('../helpers/store');
  const { open, schedule } = await isStoreOpen(req.vendorId);
  res.json({ is_open: open });
});

router.get('/delivery-boys', async (req, res) => {
  const [boys] = await db.query(
    'SELECT id, name, phone, is_active FROM delivery_boys WHERE vendor_id=? ORDER BY name',
    [req.vendorId]
  );
  res.json(boys);
});

router.get('/schedule', async (req, res) => {
  const [schedule] = await db.query(
    'SELECT * FROM store_schedule WHERE vendor_id=? ORDER BY day_of_week',
    [req.vendorId]
  );
  res.json(schedule);
});

router.get('/settings', async (req, res) => {
  const keys = ['restaurant_name', 'restaurant_tagline', 'estimated_time', 'cod_enabled',
    'online_payment_enabled', 'service_radius_km', 'google_review_link'];
  const [rows] = await db.query(
    'SELECT setting_key, setting_value FROM settings WHERE vendor_id=? AND setting_key IN (?)',
    [req.vendorId, keys]
  );
  const settings = {};
  for (const r of rows) settings[r.setting_key] = r.setting_value;
  res.json(settings);
});

module.exports = router;
