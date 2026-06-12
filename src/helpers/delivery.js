const db = require('../config/db');
const { sendWhatsApp, sendButtonMessage } = require('./whatsapp');
const { getSetting } = require('./settings');
const { cartSummary } = require('./order');
const { getBillUrl } = require('./payment');
const { isFeatureEnabled } = require('./store');

async function sendDeliveryAssignment(order, boy, vendorId) {
  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  const summary = cartSummary(items);
  const mapsLink = order.customer_lat
    ? `\n🗺️ https://maps.google.com/?q=${order.customer_lat},${order.customer_lng}`
    : '';

  const body =
    `👤 *${order.customer_name}* | ${order.customer_phone}\n` +
    `📍 ${order.delivery_address}${mapsLink}\n\n` +
    `${summary}\n\n` +
    `💰 Total: ₹${order.total}\n` +
    `💳 ${order.payment_method === 'cod' ? '💵 Cash on Delivery' : '✅ Online Paid'}`;

  await sendButtonMessage(
    boy.whatsapp_number,
    body,
    [
      { id: `db_delivered_${order.id}`, title: '✅ Delivered' },
      { id: `db_issue_${order.id}`,     title: '❌ Issue Hai' }
    ],
    vendorId,
    `🛵 Delivery #${order.order_number}`
  );
}

async function handleDeliveryConfirmed(deliveryPhone, orderId, vendorId) {
  const [rows] = await db.query('SELECT * FROM orders WHERE id = ? AND vendor_id = ?', [orderId, vendorId]);
  if (!rows.length) return;
  const order = rows[0];

  const updates = { order_status: 'delivered' };
  if (order.payment_method === 'cod') updates.payment_status = 'paid';
  await db.query('UPDATE orders SET order_status = ?, payment_status = ? WHERE id = ?',
    [updates.order_status, updates.payment_status || order.payment_status, orderId]);

  await sendWhatsApp(deliveryPhone, `✅ Delivery confirmed for order #${order.order_number}. Thank you!`, vendorId);

  const reviewLink = await getSetting('google_review_link', vendorId);
  const billEnabled = await isFeatureEnabled('bill_generation', vendorId);
  let billUrl = null;
  if (billEnabled && order.bill_token) {
    billUrl = await getBillUrl(order.bill_token, vendorId);
  }

  const customerMsg =
    `🎉 *Order Delivered!*\n\nHi ${order.customer_name || 'there'}! Your order *#${order.order_number}* has been delivered.\n\n` +
    `${order.payment_method === 'cod' ? `💵 Please pay *₹${order.total}* to the delivery person.\n\n` : ''}` +
    `Thank you for ordering! We hope you enjoy your meal. 🙏` +
    (billUrl ? `\n\n🧾 *Your Bill:* ${billUrl}` : '') +
    (reviewLink ? `\n\n⭐ *Rate us:* ${reviewLink}` : '');
  const customerMsgVendorId = order.msg_vendor_id || vendorId;
  await sendWhatsApp(order.phone, customerMsg, customerMsgVendorId);

  const adminPhone = await getSetting('restaurant_phone', vendorId);
  if (adminPhone) {
    const adminMsg =
      `✅ *Order Delivered*\n\n` +
      `Order: #${order.order_number}\n` +
      `Customer: ${order.customer_name}\n` +
      (order.payment_method === 'cod' ? `💵 COD collected: ₹${order.total}` : '✅ Already paid online');
    await sendWhatsApp(adminPhone, adminMsg, vendorId);
  }

  await db.query('UPDATE orders SET review_sent = 1 WHERE id = ?', [orderId]);
}

async function handleDeliveryIssue(deliveryPhone, orderId, vendorId) {
  const [rows] = await db.query('SELECT * FROM orders WHERE id = ? AND vendor_id = ?', [orderId, vendorId]);
  if (!rows.length) return;
  const order = rows[0];

  await sendWhatsApp(deliveryPhone, `⚠️ Issue reported for order #${order.order_number}. Admin ko alert bhej diya gaya hai.`, vendorId);

  const adminPhone = await getSetting('restaurant_phone', vendorId);
  if (adminPhone) {
    await sendWhatsApp(adminPhone,
      `🚨 *Delivery Issue Alert!*\n\nOrder: #${order.order_number}\nCustomer: ${order.customer_name} | ${order.customer_phone}\nDelivery boy ne issue report kiya hai.`,
      vendorId
    );
  }
}

module.exports = { sendDeliveryAssignment, handleDeliveryConfirmed, handleDeliveryIssue };
