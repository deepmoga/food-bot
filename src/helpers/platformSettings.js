const db = require('../config/db');

const _cache = {};

async function getPlatformSetting(key) {
  if (_cache[key] !== undefined) return _cache[key];
  const [[row]] = await db.query('SELECT setting_value FROM platform_settings WHERE setting_key=?', [key]);
  const val = row?.setting_value || '';
  _cache[key] = val;
  return val;
}

async function setPlatformSetting(key, value) {
  await db.query(
    'INSERT INTO platform_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=?',
    [key, value, value]
  );
  _cache[key] = value;
}

function clearPlatformCache() {
  Object.keys(_cache).forEach(k => delete _cache[k]);
}

module.exports = { getPlatformSetting, setPlatformSetting, clearPlatformCache };
