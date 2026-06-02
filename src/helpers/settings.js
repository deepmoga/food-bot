const db = require('../config/db');

// In-memory cache: { vendorId: { key: value, __ts: timestamp } }
const cache = {};
const CACHE_TTL = 60 * 1000; // 1 minute

async function loadSettings(vendorId) {
  const [rows] = await db.query(
    'SELECT setting_key, setting_value FROM settings WHERE vendor_id = ?',
    [vendorId]
  );
  const map = {};
  for (const row of rows) map[row.setting_key] = row.setting_value;
  map.__ts = Date.now();
  cache[vendorId] = map;
  return map;
}

async function getSetting(key, vendorId) {
  const now = Date.now();
  if (!cache[vendorId] || now - cache[vendorId].__ts > CACHE_TTL) {
    await loadSettings(vendorId);
  }
  return cache[vendorId]?.[key] ?? null;
}

async function getSettings(vendorId) {
  const now = Date.now();
  if (!cache[vendorId] || now - cache[vendorId].__ts > CACHE_TTL) {
    await loadSettings(vendorId);
  }
  return cache[vendorId] || {};
}

function clearCache(vendorId) {
  delete cache[vendorId];
}

async function saveSetting(key, value, vendorId) {
  await db.query(
    'UPDATE settings SET setting_value = ? WHERE vendor_id = ? AND setting_key = ?',
    [value, vendorId, key]
  );
  clearCache(vendorId);
}

module.exports = { getSetting, getSettings, clearCache, saveSetting };
