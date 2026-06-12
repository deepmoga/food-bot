const db = require('../config/db');
const { getSetting } = require('./settings');
const { sendWhatsApp } = require('./whatsapp');
const { cartTotal } = require('./gst');
const { createBillToken, getBillUrl } = require('./payment');

async function generateOrderNumber(vendorId) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const [rows] = await db.query(
    `SELECT COUNT(*) as cnt FROM orders
     WHERE vendor_id = ? AND DATE(created_at) = CURDATE()`,
    [vendorId]
  );
  const seq = String((rows[0].cnt || 0) + 1).padStart(4, '0');
  return `ORD-${today}-${seq}`;
}

async function createOrder(session, cart, breakdown, vendorId, msgVendorId = null) {
  const orderNumber = await generateOrderNumber(vendorId);
  const now = new Date();
  const billToken = createBillToken(orderNumber, orderNumber, now.toISOString());

  const [result] = await db.query(
    `INSERT INTO orders
      (vendor_id, msg_vendor_id, order_number, phone, customer_name, customer_phone, items,
       subtotal, discount_amount, delivery_charge, gst_amount, total,
       payment_method, payment_status, order_status,
       delivery_address, customer_lat, customer_lng, distance_km,
       coupon_code, bill_token)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      vendorId, msgVendorId || vendorId, orderNumber, session.phone, session.customer_name, session.customer_phone,
      JSON.stringify(cart),
      breakdown.subtotal, breakdown.discount, breakdown.delivery, breakdown.gst, breakdown.total,
      session.payment_method,
      session.payment_method === 'cod' ? 'cod_pending' : 'pending',
      'waiting',
      session.temp_address, session.temp_lat, session.temp_lng, session.temp_dist,
      session.pending_coupon || null,
      billToken
    ]
  );

  // Update token with real ID
  const orderId = result.insertId;
  const realToken = createBillToken(orderId, orderNumber, now.toISOString());
  await db.query('UPDATE orders SET bill_token = ? WHERE id = ?', [realToken, orderId]);

  return { id: orderId, order_number: orderNumber, bill_token: realToken, ...breakdown };
}

function cartSummary(cart) {
  return cart.map(item => {
    const addons = (item.addons || []).map(a => a.name).join(', ');
    return `• ${item.name}${addons ? ` (${addons})` : ''} x${item.qty} — ₹${((item.price + (item.addons || []).reduce((s,a) => s + a.price, 0)) * item.qty).toFixed(0)}`;
  }).join('\n');
}

async function notifyRestaurant(order, vendorId) {
  const phone = await getSetting('restaurant_phone', vendorId);
  const name = await getSetting('restaurant_name', vendorId);
  if (!phone) return;

  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  const summary = cartSummary(items);
  const mapsLink = order.customer_lat
    ? `\n🗺️ https://maps.google.com/?q=${order.customer_lat},${order.customer_lng}`
    : '';

  const msg =
    `🔔 *New Order — ${name}*\n\n` +
    `📦 Order: *#${order.order_number}*\n` +
    `👤 ${order.customer_name} | ${order.customer_phone}\n\n` +
    `${summary}\n\n` +
    `💰 Total: ₹${order.total}\n` +
    `💳 Payment: ${order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online'}\n` +
    `📍 ${order.delivery_address || 'Pickup'}${mapsLink}`;

  await sendWhatsApp(phone, msg, vendorId);
}

async function sendReviewRequests() {
  const reviewMinutes = 60;
  const [orders] = await db.query(
    `SELECT o.*, s.setting_value as review_link
     FROM orders o
     LEFT JOIN settings s ON s.vendor_id = o.vendor_id AND s.setting_key = 'google_review_link'
     WHERE o.order_status = 'delivered'
       AND o.review_sent = 0
       AND o.updated_at <= NOW() - INTERVAL ? MINUTE`,
    [reviewMinutes]
  );

  for (const order of orders) {
    if (!order.review_link) continue;
    const msg =
      `Hi ${order.customer_name || 'there'}! 🙏 Thank you for your order *#${order.order_number}*.\n\n` +
      `We'd love to hear your feedback! Please take a moment to rate us:\n${order.review_link}`;
    const msgVendorId = order.msg_vendor_id || order.vendor_id;
    await sendWhatsApp(order.phone, msg, msgVendorId);
    await db.query('UPDATE orders SET review_sent = 1 WHERE id = ?', [order.id]);
  }
}

module.exports = { createOrder, cartSummary, notifyRestaurant, generateOrderNumber, sendReviewRequests };
