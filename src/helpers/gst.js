const { getSetting } = require('./settings');

async function calculateGST(subtotal, vendorId) {
  const enabled = await getSetting('gst_enabled', vendorId);
  if (enabled !== '1') return 0;
  const percent = parseFloat(await getSetting('gst_percent', vendorId)) || 5;
  const included = await getSetting('gst_included', vendorId);
  if (included === '1') {
    return parseFloat((subtotal - (subtotal * 100 / (100 + percent))).toFixed(2));
  }
  return parseFloat((subtotal * percent / 100).toFixed(2));
}

async function orderBreakdown(cart, discount, deliveryCharge, vendorId, pendingCoupon = null) {
  const subtotal = cartTotal(cart);
  let finalDiscount = discount;
  if (!pendingCoupon) {
    const { getAutomaticDiscount } = require('./discount');
    finalDiscount = await getAutomaticDiscount(subtotal, vendorId);
  }
  const gst = await calculateGST(subtotal, vendorId);
  const gstIncluded = await getSetting('gst_included', vendorId) === '1';
  const total = gstIncluded
    ? subtotal - finalDiscount + deliveryCharge
    : subtotal + gst - finalDiscount + deliveryCharge;
  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    gst: parseFloat(gst.toFixed(2)),
    gst_included: gstIncluded,
    delivery: parseFloat(deliveryCharge.toFixed(2)),
    discount: parseFloat(finalDiscount.toFixed(2)),
    total: parseFloat(Math.max(0, total).toFixed(2))
  };
}

function cartTotal(cart) {
  return cart.reduce((sum, item) => {
    const addonSum = (item.addons || []).reduce((a, ad) => a + (ad.price || 0), 0);
    return sum + (item.price + addonSum) * item.qty;
  }, 0);
}

module.exports = { calculateGST, orderBreakdown, cartTotal };
