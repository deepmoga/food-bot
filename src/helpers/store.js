const db = require('../config/db');
const { getSetting } = require('./settings');

async function isStoreOpen(vendorId) {
  const manualOpen = await getSetting('store_open', vendorId);
  if (manualOpen !== '1') {
    return { open: false, reason: 'manual' };
  }

  const featureEnabled = await isFeatureEnabled('store_schedule', vendorId);
  if (!featureEnabled) return { open: true, reason: 'manual' };

  const timezone = (await getSetting('store_timezone', vendorId)) || 'Asia/Kolkata';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const dayOfWeek = now.getDay();
  const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:00`;

  const [rows] = await db.query(
    'SELECT * FROM store_schedule WHERE vendor_id = ? AND day_of_week = ?',
    [vendorId, dayOfWeek]
  );
  if (!rows.length || !rows[0].is_open) {
    return { open: false, reason: 'day_off' };
  }

  const { open_time, close_time } = rows[0];
  if (currentTime < open_time) return { open: false, reason: 'not_yet' };
  if (currentTime >= close_time) return { open: false, reason: 'closed' };

  return { open: true, reason: 'schedule' };
}

async function getClosedMessage(vendorId) {
  return (await getSetting('store_closed_msg', vendorId)) ||
    'Sorry, we are closed right now. Please visit us during business hours.';
}

async function isFeatureEnabled(featureKey, vendorId) {
  const [rows] = await db.query(
    'SELECT is_enabled FROM vendor_features WHERE vendor_id = ? AND feature_key = ?',
    [vendorId, featureKey]
  );
  return rows.length > 0 ? rows[0].is_enabled === 1 : false;
}

module.exports = { isStoreOpen, getClosedMessage, isFeatureEnabled };
