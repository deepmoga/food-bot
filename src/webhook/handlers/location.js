const { getSession, updateSession } = require('../../helpers/session');
const { getSetting } = require('../../helpers/settings');
const { getDistanceKm, calculateDeliveryCharge } = require('../../helpers/geo');
const { cartTotal, orderBreakdown } = require('../../helpers/gst');
const { cartSummary } = require('../../helpers/order');
const { sendWhatsApp, sendButtonMessage } = require('../../helpers/whatsapp');

async function handleLocation(phone, lat, lng, locName, locAddress, vendorId) {
  const session = await getSession(phone, vendorId);
  if (session.state !== 'GET_ADDRESS') return;

  const restLat = parseFloat(await getSetting('restaurant_lat', vendorId));
  const restLng = parseFloat(await getSetting('restaurant_lng', vendorId));
  const radius = parseFloat(await getSetting('service_radius_km', vendorId)) || 5;

  if (!restLat || !restLng) {
    await sendWhatsApp(phone, '❌ Restaurant location not configured. Please enter your address as text.', vendorId);
    return;
  }

  const dist = getDistanceKm(restLat, restLng, lat, lng);
  if (dist > radius) {
    await sendWhatsApp(phone, `❌ Sorry, we don't deliver to your location.\n\nWe deliver within ${radius} km radius.\nYour distance: ${dist.toFixed(1)} km`, vendorId);
    return;
  }

  const addressParts = [locName, locAddress].filter(Boolean);
  const address = addressParts.join(', ') || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);
  const total = cartTotal(cart);
  const deliveryCharge = await calculateDeliveryCharge(total, vendorId);
  const discount = parseFloat(session.pending_discount) || 0;
  const breakdown = await orderBreakdown(cart, discount, deliveryCharge, vendorId);
  const summary = cartSummary(cart);

  await updateSession(phone, vendorId, {
    temp_address: address,
    temp_lat: lat,
    temp_lng: lng,
    temp_dist: parseFloat(dist.toFixed(2)),
    delivery_charge: deliveryCharge,
    state: 'CHOOSE_PAYMENT'
  });

  const eta = await getSetting('estimated_time', vendorId);
  const codEnabled = await getSetting('cod_enabled', vendorId);
  const onlineEnabled = await getSetting('online_payment_enabled', vendorId);

  const body =
    `📍 *Location confirmed!*\n${address}\n🚚 Distance: ${dist.toFixed(1)} km\n\n` +
    `🛒 *Order Summary*\n${summary}\n\n` +
    `💰 Subtotal: ₹${breakdown.subtotal}\n` +
    (breakdown.discount > 0 ? `🏷️ Discount: -₹${breakdown.discount}\n` : '') +
    (breakdown.delivery > 0 ? `🚚 Delivery: ₹${breakdown.delivery}\n` : `🚚 Delivery: *FREE*\n`) +
    (breakdown.gst > 0 ? `📊 GST: ₹${breakdown.gst}\n` : '') +
    `\n💵 *Total: ₹${breakdown.total}*\n⏱️ ETA: ${eta} mins\n\nChoose payment method:`;

  const buttons = [];
  if (onlineEnabled === '1') buttons.push({ id: 'pay_online', title: '💳 Pay Online' });
  if (codEnabled === '1') buttons.push({ id: 'pay_cod', title: '💵 Cash on Delivery' });

  if (!buttons.length) {
    await sendWhatsApp(phone, '❌ No payment methods available. Please contact us.', vendorId);
    return;
  }

  await sendButtonMessage(phone, body, buttons, vendorId);
}

module.exports = { handleLocation };
