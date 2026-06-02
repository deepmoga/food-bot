const db = require('../config/db');

async function validateCoupon(code, phone, cartTotal, vendorId) {
  const [rows] = await db.query(
    'SELECT * FROM coupons WHERE vendor_id = ? AND code = ? AND is_active = 1',
    [vendorId, code.toUpperCase()]
  );
  if (!rows.length) return { valid: false, message: '❌ Invalid coupon code.' };

  const coupon = rows[0];
  const now = new Date();

  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    return { valid: false, message: '❌ This coupon has expired.' };
  }
  if (coupon.usage_limit > 0 && coupon.used_count >= coupon.usage_limit) {
    return { valid: false, message: '❌ This coupon has reached its usage limit.' };
  }
  if (coupon.min_order > 0 && cartTotal < coupon.min_order) {
    return { valid: false, message: `❌ Minimum order of ₹${coupon.min_order} required for this coupon.` };
  }

  if (coupon.per_user_limit > 0) {
    const [usageRows] = await db.query(
      'SELECT COUNT(*) as cnt FROM coupon_usage WHERE coupon_id = ? AND phone = ? AND vendor_id = ?',
      [coupon.id, phone, vendorId]
    );
    if (usageRows[0].cnt >= coupon.per_user_limit) {
      return { valid: false, message: '❌ You have already used this coupon.' };
    }
  }

  let discount = 0;
  if (coupon.type === 'flat') {
    discount = coupon.value;
  } else {
    discount = (cartTotal * coupon.value) / 100;
    if (coupon.max_discount > 0) discount = Math.min(discount, coupon.max_discount);
  }
  discount = parseFloat(Math.min(discount, cartTotal).toFixed(2));

  return { valid: true, discount, coupon };
}

async function applyCouponUsage(couponId, phone, orderId, discountAmount, vendorId) {
  await db.query(
    'INSERT INTO coupon_usage (vendor_id, coupon_id, phone, order_id, discount_amount) VALUES (?,?,?,?,?)',
    [vendorId, couponId, phone, orderId, discountAmount]
  );
  await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [couponId]);
}

module.exports = { validateCoupon, applyCouponUsage };
