const { getSetting } = require('./settings');

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

async function calculateDeliveryCharge(cartTotal, vendorId) {
  const freeAbove = parseFloat(await getSetting('free_delivery_above', vendorId)) || 500;
  const charge = parseFloat(await getSetting('delivery_charge', vendorId)) || 50;
  return cartTotal >= freeAbove ? 0 : charge;
}

module.exports = { getDistanceKm, calculateDeliveryCharge };
