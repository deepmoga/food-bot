const { getSession, resetSession } = require('../helpers/session');
const { cartTotal, orderBreakdown } = require('../helpers/gst');
const { createOrder, cartSummary, notifyRestaurant } = require('../helpers/order');
const { applyCouponUsage } = require('../helpers/coupon');
const { createPaymentLink, getBillUrl } = require('../helpers/payment');
const { sendWhatsApp } = require('../helpers/whatsapp');
const { getSetting } = require('../helpers/settings');
const { isFeatureEnabled } = require('../helpers/store');
const db = require('../config/db');

async function placeOrder(phone, vendorId) {
  const session = await getSession(phone, vendorId);
  const activeVendorId = session.selected_vendor_id || vendorId;
  const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);

  if (!cart.length) {
    await sendWhatsApp(phone, '❌ Your cart is empty. Please add items first.', vendorId);
    return;
  }

  const total = cartTotal(cart);
  const discount = parseFloat(session.pending_discount) || 0;
  const delivery = parseFloat(session.delivery_charge) || 0;
  const breakdown = await orderBreakdown(cart, discount, delivery, activeVendorId, session.pending_coupon);

  // vendorId here is the inbound number's vendor (e.g. shared platform directory number
  // for directory-mode customers) — persisted so future notifications (status updates,
  // bills, reviews) keep using the SAME number the customer's conversation is open with,
  // even after resetSession() clears session.selected_vendor_id.
  const order = await createOrder(session, cart, breakdown, activeVendorId, vendorId);

  // Record coupon usage
  if (session.pending_coupon && session.pending_discount > 0) {
    const [cRows] = await db.query(
      'SELECT id FROM coupons WHERE vendor_id = ? AND code = ?',
      [activeVendorId, session.pending_coupon]
    );
    if (cRows.length) {
      await applyCouponUsage(cRows[0].id, phone, order.id, discount, activeVendorId);
    }
  }

  await resetSession(phone, vendorId);

  const eta = await getSetting('estimated_time', activeVendorId);
  const restName = await getSetting('restaurant_name', activeVendorId) || 'Restaurant';
  const summary = cartSummary(cart);

  if (session.payment_method === 'cod') {
    // ✅ Fix: "Order Received" - waiting status, NO bill link yet
    const msg =
      `🛒 *Order Received!*\n\n` +
      `📦 Order: *#${order.order_number}*\n\n` +
      `${summary}\n\n` +
      `💰 Subtotal: ₹${breakdown.subtotal}\n` +
      (breakdown.discount > 0 ? `🏷️ Discount: -₹${breakdown.discount}\n` : '') +
      (breakdown.delivery > 0 ? `🚚 Delivery: ₹${breakdown.delivery}\n` : '') +
      (breakdown.gst > 0 ? `📊 GST: ₹${breakdown.gst}\n` : '') +
      `💵 *Total: ₹${breakdown.total}* (Cash on Delivery)\n\n` +
      `📍 ${session.temp_address || 'Pickup'}\n` +
      `⏱️ Estimated time: ${eta} mins\n\n` +
      `⏳ Your order is being reviewed. We'll confirm it shortly!\n\n` +
      `Thank you for ordering from *${restName}*! 🙏`;

    await sendWhatsApp(phone, msg, vendorId);
    await notifyRestaurant({
      ...order,
      items: JSON.stringify(cart),
      delivery_address: session.temp_address,
      customer_lat: session.temp_lat,
      customer_lng: session.temp_lng,
      phone,
      customer_name: session.customer_name,
      customer_phone: session.customer_phone,
      payment_method: 'cod',
      total: breakdown.total
    }, activeVendorId);

  } else {
    // Online payment
    try {
      const [orderRow] = await db.query('SELECT * FROM orders WHERE id = ?', [order.id]);
      const paymentLink = await createPaymentLink(orderRow[0], activeVendorId);

      await db.query('UPDATE orders SET payment_link = ? WHERE id = ?', [paymentLink, order.id]);

      const msg =
        `🛒 *Order Received!*\n\n` +
        `📦 Order: *#${order.order_number}*\n\n` +
        `${summary}\n\n` +
        `💰 *Total: ₹${breakdown.total}*\n\n` +
        `Please complete your payment:\n👉 ${paymentLink}\n\n` +
        `Your order will be confirmed after payment. ⏳`;

      await sendWhatsApp(phone, msg, vendorId);
      await notifyRestaurant({
        ...order,
        items: JSON.stringify(cart),
        delivery_address: session.temp_address,
        customer_lat: session.temp_lat,
        customer_lng: session.temp_lng,
        phone,
        customer_name: session.customer_name,
        customer_phone: session.customer_phone,
        payment_method: 'online',
        total: breakdown.total
      }, activeVendorId);
    } catch (e) {
      console.error('[placeOrder] Razorpay error:', e.message);
      await sendWhatsApp(phone, '❌ Payment link generate karne mein error aaya. Please contact us.', vendorId);
    }
  }
}

module.exports = { placeOrder };
