const db = require('../config/db');

async function getSession(phone, vendorId) {
  const [rows] = await db.query(
    'SELECT * FROM sessions WHERE phone = ? AND vendor_id = ?',
    [phone, vendorId]
  );
  if (rows.length > 0) {
    const s = rows[0];
    s.cart = s.cart || [];
    return s;
  }
  // Create new session
  await db.query(
    'INSERT INTO sessions (phone, vendor_id, state, cart) VALUES (?, ?, "WELCOME", "[]")',
    [phone, vendorId]
  );
  return { phone, vendor_id: vendorId, state: 'WELCOME', cart: [] };
}

async function updateSession(phone, vendorId, data) {
  if (data.cart !== undefined && typeof data.cart !== 'string') {
    data.cart = JSON.stringify(data.cart);
  }
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  await db.query(
    `UPDATE sessions SET ${fields} WHERE phone = ? AND vendor_id = ?`,
    [...values, phone, vendorId]
  );
}

async function getCart(phone, vendorId) {
  const [rows] = await db.query(
    'SELECT cart FROM sessions WHERE phone = ? AND vendor_id = ?',
    [phone, vendorId]
  );
  if (!rows.length) return [];
  try {
    return JSON.parse(rows[0].cart) || [];
  } catch (_) {
    return [];
  }
}

async function saveCart(phone, vendorId, cart) {
  await db.query(
    'UPDATE sessions SET cart = ? WHERE phone = ? AND vendor_id = ?',
    [JSON.stringify(cart), phone, vendorId]
  );
}

async function resetSession(phone, vendorId) {
  await db.query(
    `UPDATE sessions SET
      state='WELCOME', cart='[]', pending_item_id=NULL, pending_coupon=NULL,
      pending_discount=0, delivery_charge=0, payment_method=NULL, pending_addons=NULL,
      temp_address=NULL, temp_lat=NULL, temp_lng=NULL, temp_dist=NULL,
      customer_name=NULL, customer_phone=NULL
    WHERE phone = ? AND vendor_id = ?`,
    [phone, vendorId]
  );
}

module.exports = { getSession, updateSession, getCart, saveCart, resetSession };
