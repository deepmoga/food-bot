const { getSession, updateSession } = require('../../helpers/session');
const { getSetting } = require('../../helpers/settings');
const { getDistanceKm, calculateDeliveryCharge } = require('../../helpers/geo');
const { cartTotal, orderBreakdown } = require('../../helpers/gst');
const { cartSummary } = require('../../helpers/order');
const { sendWhatsApp, sendButtonMessage } = require('../../helpers/whatsapp');

async function handleLocation(phone, lat, lng, locName, locAddress, vendorId) {
  const session = await getSession(phone, vendorId);
  if (session.state !== 'GET_ADDRESS') return;

  const restLat  = parseFloat(await getSetting('restaurant_lat', vendorId));
  const restLng  = parseFloat(await getSetting('restaurant_lng', vendorId));
  const radius   = parseFloat(await getSetting('service_radius_km', vendorId)) || 5;
  const restName = (await getSetting('restaurant_name', vendorId)) || 'We';

  // Restaurant location not set — fallback to text
  if (!restLat || !restLng) {
    await sendWhatsApp(phone,
      'Please enter your delivery address as text.',
      vendorId);
    return;
  }

  const dist = getDistanceKm(restLat, restLng, lat, lng);

  // Outside delivery zone
  if (dist > radius) {
    await sendWhatsApp(phone,
      `Sorry! We are unable to deliver to your location.\n\n` +
      `*${restName}* delivers within *${radius} km* only.\n` +
      `Your location is *${dist.toFixed(1)} km* away from us.\n\n` +
      `Please visit us at our restaurant or choose a closer location.\n\n` +
      `Thank you for your interest!`,
      vendorId);
    return;
  }

  const addressParts = [locName, locAddress].filter(Boolean);
  const address = addressParts.join(', ') || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);
  const total = cartTotal(cart);
  const deliveryCharge = await calculateDeliveryCharge(total, vendorId);
  const discount = parseFloat(session.pending_discount) || 0;
  const breakdown = await orderBreakdown(cart, discount, deliveryCharge, vendorId, session.pending_coupon);
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
    `Location confirmed!\n${address}\n` +
    `Distance: ${dist.toFixed(1)} km\n\n` +
    `*Order Summary*\n${summary}\n\n` +
    `Subtotal: Rs.${breakdown.subtotal}\n` +
    (breakdown.discount > 0 ? `Discount: -Rs.${breakdown.discount}\n` : '') +
    (breakdown.delivery > 0 ? `Delivery: Rs.${breakdown.delivery}\n` : `Delivery: *FREE*\n`) +
    (breakdown.gst > 0 ? `GST: Rs.${breakdown.gst}\n` : '') +
    `\n*Total: Rs.${breakdown.total}*\n` +
    `Estimated time: ${eta} mins\n\n` +
    `Choose payment method:`;

  const buttons = [];
  if (onlineEnabled === '1') buttons.push({ id: 'pay_online', title: 'Pay Online' });
  if (codEnabled    === '1') buttons.push({ id: 'pay_cod',    title: 'Cash on Delivery' });

  if (!buttons.length) {
    await sendWhatsApp(phone, 'No payment methods available. Please contact us.', vendorId);
    return;
  }

  await sendButtonMessage(phone, body, buttons, vendorId);
}

module.exports = { handleLocation };
