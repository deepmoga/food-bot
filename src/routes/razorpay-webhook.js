const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const { getSetting } = require('../helpers/settings');
const { sendWhatsApp } = require('../helpers/whatsapp');
const { getBillUrl } = require('../helpers/payment');
const { notifyRestaurant } = require('../helpers/order');
const { isFeatureEnabled } = require('../helpers/store');

router.post('/', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const body = req.rawBody;

  try {
    const payload = JSON.parse(body.toString());
    const vendorId = payload?.payload?.payment?.entity?.notes?.vendor_id || payload?.payload?.payment_link?.entity?.notes?.vendor_id;
    if (!vendorId) return res.sendStatus(200);

    const webhookSecret = await getSetting('razorpay_webhook_secret', vendorId);
    if (webhookSecret) {
      const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
      if (expected !== signature) return res.sendStatus(400);
    }

    if (payload.event !== 'payment.captured' && payload.event !== 'payment_link.paid') {
      return res.sendStatus(200);
    }

    const orderNumber = payload?.payload?.payment?.entity?.notes?.order_number ||
                        payload?.payload?.payment_link?.entity?.notes?.order_number;
    if (!orderNumber) return res.sendStatus(200);

    const [orders] = await db.query('SELECT * FROM orders WHERE order_number = ? AND vendor_id = ?', [orderNumber, vendorId]);
    if (!orders.length) return res.sendStatus(200);

    const order = orders[0];
    if (order.payment_status === 'paid') return res.sendStatus(200);

    await db.query("UPDATE orders SET payment_status='paid', order_status='confirmed' WHERE id=?", [order.id]);

    // Send bill
    const billEnabled = await isFeatureEnabled('bill_generation', vendorId);
    if (billEnabled && order.bill_token) {
      const billUrl = await getBillUrl(order.bill_token, vendorId);
      const msg = `✅ *Payment Received!*\n\nOrder *#${order.order_number}* confirmed.\n\n🧾 View your bill: ${billUrl}\n\nThank you for ordering! 🙏`;
      const msgVendorId = order.msg_vendor_id || vendorId;
      await sendWhatsApp(order.phone, msg, msgVendorId);
    }

    // Notify restaurant
    await notifyRestaurant({ ...order, items: order.items }, vendorId);

    res.sendStatus(200);
  } catch (e) {
    console.error('[Razorpay Webhook]', e.message);
    res.sendStatus(200);
  }
});

module.exports = router;
