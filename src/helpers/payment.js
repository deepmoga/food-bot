const crypto = require('crypto');
const { getSetting } = require('./settings');

async function getRazorpay(vendorId) {
  const Razorpay = require('razorpay');
  const keyId = await getSetting('razorpay_key_id', vendorId);
  const keySecret = await getSetting('razorpay_key_secret', vendorId);
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

async function createPaymentLink(order, vendorId) {
  const instance = await getRazorpay(vendorId);
  const restName = await getSetting('restaurant_name', vendorId);
  const amountPaise = Math.round(order.total * 100);

  const paymentLink = await instance.paymentLink.create({
    amount: amountPaise,
    currency: 'INR',
    accept_partial: false,
    description: `Order #${order.order_number} - ${restName}`,
    customer: {
      name: order.customer_name || '',
      contact: order.customer_phone || order.phone
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: { order_number: order.order_number, vendor_id: String(vendorId) },
    callback_url: `${await getSetting('base_url', vendorId)}/payment-callback?order=${order.order_number}`,
    callback_method: 'get'
  });

  return paymentLink.short_url;
}

function createBillToken(id, orderNumber, createdAt) {
  return crypto
    .createHash('sha256')
    .update(`${id}${orderNumber}${createdAt}`)
    .digest('hex');
}

async function getBillUrl(token, vendorId) {
  const base = await getSetting('base_url', vendorId);
  return `${base}/bill/${token}`;
}

module.exports = { createPaymentLink, createBillToken, getBillUrl };
