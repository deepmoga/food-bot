const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/', async (req, res) => {
  const { order: orderNumber } = req.query;
  let status = 'pending';
  let orderData = null;

  if (orderNumber) {
    const [rows] = await db.query('SELECT order_number, customer_name, total, payment_status FROM orders WHERE order_number = ?', [orderNumber]);
    if (rows.length) { orderData = rows[0]; status = rows[0].payment_status; }
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Status</title>
<style>
body{font-family:'Segoe UI',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#fff;border-radius:16px;padding:36px;text-align:center;max-width:360px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,.1)}
.icon{font-size:56px;margin-bottom:16px}
h2{font-size:22px;font-weight:700;margin-bottom:8px}
p{color:#6b7280;font-size:14px}
.badge{display:inline-block;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;margin-top:12px}
.paid{background:#d1fae5;color:#065f46}.pending{background:#fef3c7;color:#92400e}
</style>
</head>
<body>
<div class="box">
  ${status === 'paid'
    ? `<div class="icon">🎉</div><h2>Payment Successful!</h2>`
    : `<div class="icon">⏳</div><h2>Payment Processing</h2>`}
  ${orderData ? `<p>Order <strong>#${orderData.order_number}</strong></p><p>₹${orderData.total}</p>` : ''}
  <span class="badge ${status === 'paid' ? 'paid' : 'pending'}">${status === 'paid' ? '✅ Paid' : '⏳ Pending'}</span>
  <p style="margin-top:16px;font-size:13px">You will receive a WhatsApp confirmation shortly. You can close this window.</p>
</div>
</body>
</html>`);
});

module.exports = router;
