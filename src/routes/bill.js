const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { getSettings } = require('../helpers/settings');
const { orderBreakdown } = require('../helpers/gst');

router.get('/:token', async (req, res) => {
  const { token } = req.params;
  const [rows] = await db.query('SELECT * FROM orders WHERE bill_token = ?', [token]);
  if (!rows.length) return res.status(404).send('<h2>Bill not found.</h2>');

  const order = rows[0];
  if (!order.bill_viewed_at) {
    await db.query('UPDATE orders SET bill_viewed_at = NOW() WHERE id = ?', [order.id]);
  }

  const settings = await getSettings(order.vendor_id);
  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  const breakdown = await orderBreakdown(items, order.discount_amount, order.delivery_charge, order.vendor_id);

  const logoUrl = settings.restaurant_logo_url;
  const restName = settings.restaurant_name || 'Restaurant';
  const restAddr = settings.restaurant_address || '';
  const tagline = settings.restaurant_tagline || '';
  const gstin = settings.restaurant_gstin || '';
  const footer = settings.bill_footer_text || 'Thank you for ordering!';
  const gstPercent = settings.gst_percent || '5';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bill #${order.order_number}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#f5f5f5;color:#111;padding:20px}
.bill{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.1)}
.header{background:#1db954;color:#fff;padding:24px;text-align:center}
.header img{width:70px;height:70px;border-radius:50%;object-fit:cover;margin-bottom:8px;background:#fff}
.header h1{font-size:20px;font-weight:700;margin-bottom:2px}
.header p{font-size:13px;opacity:.85}
.section{padding:16px 20px;border-bottom:1px solid #f0f0f0}
.section h3{font-size:12px;text-transform:uppercase;color:#6b7280;margin-bottom:10px;font-weight:600}
.row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;font-size:14px}
.row .name{flex:1;padding-right:8px}
.row .qty{color:#6b7280;font-size:12px}
.row .price{font-weight:500;white-space:nowrap}
.divider{border:none;border-top:1px dashed #e5e7eb;margin:4px 0}
.total-section{padding:16px 20px}
.total-row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;color:#374151}
.total-row.grand{font-size:16px;font-weight:700;color:#111;border-top:2px solid #111;padding-top:10px;margin-top:6px}
.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;background:#d1fae5;color:#065f46}
.footer{padding:20px;text-align:center;background:#f9fafb;color:#6b7280;font-size:12px}
.order-info{padding:14px 20px;background:#f9fafb;font-size:13px;color:#374151}
.order-info .info-row{display:flex;justify-content:space-between;margin-bottom:4px}
</style>
</head>
<body>
<div class="bill">
  <div class="header">
    ${logoUrl ? `<img src="${logoUrl}" alt="Logo">` : ''}
    <h1>${restName}</h1>
    ${tagline ? `<p>${tagline}</p>` : ''}
    ${restAddr ? `<p style="margin-top:4px;font-size:12px">${restAddr}</p>` : ''}
    ${gstin ? `<p style="margin-top:4px;font-size:11px">GSTIN: ${gstin}</p>` : ''}
  </div>

  <div class="order-info">
    <div class="info-row"><span><strong>Bill #${order.order_number}</strong></span><span class="badge">${order.payment_status === 'paid' ? '✅ Paid' : order.payment_status}</span></div>
    <div class="info-row"><span>Customer</span><span>${order.customer_name || '-'}</span></div>
    <div class="info-row"><span>Phone</span><span>${order.customer_phone || order.phone}</span></div>
    <div class="info-row"><span>Date</span><span>${new Date(order.created_at).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})}</span></div>
    ${order.delivery_address ? `<div class="info-row"><span>Address</span><span style="text-align:right;max-width:60%">${order.delivery_address}</span></div>` : ''}
  </div>

  <div class="section">
    <h3>Order Items</h3>
    ${items.map(item => {
      const addonNames = (item.addons||[]).map(a=>a.name).join(', ');
      const unitPrice = item.price + (item.addons||[]).reduce((s,a)=>s+a.price,0);
      return `
      <div class="row">
        <div class="name">
          ${item.name}${addonNames?`<br><span style="font-size:11px;color:#6b7280">${addonNames}</span>`:''}
          <br><span class="qty">₹${unitPrice.toFixed(2)} × ${item.qty}</span>
        </div>
        <div class="price">₹${(unitPrice * item.qty).toFixed(2)}</div>
      </div>`;
    }).join('')}
  </div>

  <div class="total-section">
    <div class="total-row"><span>Subtotal</span><span>₹${breakdown.subtotal.toFixed(2)}</span></div>
    ${breakdown.discount > 0 ? `<div class="total-row" style="color:var(--green,#1db954)"><span>Discount</span><span>−₹${breakdown.discount.toFixed(2)}</span></div>` : ''}
    ${breakdown.delivery > 0 ? `<div class="total-row"><span>Delivery</span><span>₹${breakdown.delivery.toFixed(2)}</span></div>` : ''}
    ${breakdown.gst > 0 ? `<div class="total-row"><span>GST (${gstPercent}%)${breakdown.gst_included?' (incl.)':''}</span><span>₹${breakdown.gst.toFixed(2)}</span></div>` : ''}
    <div class="total-row grand"><span>Total</span><span>₹${breakdown.total.toFixed(2)}</span></div>
    <div class="total-row" style="margin-top:8px"><span>Payment</span><span>${order.payment_method === 'cod' ? '💵 Cash on Delivery' : '💳 Online'}</span></div>
  </div>

  <div class="footer">${footer}</div>
</div>
</body>
</html>`);
});

module.exports = router;
