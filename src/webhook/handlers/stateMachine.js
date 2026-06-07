const db = require('../../config/db');
const { getSession, updateSession } = require('../../helpers/session');
const { getSetting } = require('../../helpers/settings');
const { sendWhatsApp, sendButtonMessage } = require('../../helpers/whatsapp');
const { cartTotal, orderBreakdown } = require('../../helpers/gst');
const { cartSummary } = require('../../helpers/order');
const { validateCoupon } = require('../../helpers/coupon');
const { calculateDeliveryCharge } = require('../../helpers/geo');
const { isFeatureEnabled } = require('../../helpers/store');
const { sendCategoryMenu, addToCart, sendCartSummaryButtons } = require('./buttons');

async function handleTextState(phone, text, vendorId, profileName = null) {
  const session = await getSession(phone, vendorId, profileName);
  const state = session.state || 'WELCOME';
  const lower = text.toLowerCase().trim();

  // Universal commands
  if (['hi', 'hello', 'menu', 'start'].includes(lower)) {
    await updateSession(phone, vendorId, { state: 'CATEGORY_SELECT' });
    await sendCategoryMenu(phone, vendorId);
    return;
  }
  if (lower === 'help') {
    await sendWhatsApp(phone,
      `*Help Menu*\n\n• Send *menu* to browse food\n• Send *cart* to view your cart\n• Send *cancel* to reset your order\n• Send *timings* to see store hours`,
      vendorId);
    return;
  }
  if (lower === 'cart') {
    const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);
    if (!cart.length) { await sendWhatsApp(phone, '🛒 Your cart is empty. Send *menu* to order.', vendorId); return; }
    await sendCartSummaryButtons(phone, cart, vendorId);
    return;
  }
  if (lower === 'cancel') {
    const { resetSession } = require('../../helpers/session');
    await resetSession(phone, vendorId);
    await sendWhatsApp(phone, 'Order cancelled. Send *menu* to start again.', vendorId);
    return;
  }
  if (lower === 'confirm' && (state === 'EDIT_CART' || state === 'CATEGORY_SELECT')) {
    await updateSession(phone, vendorId, { state: 'GET_NAME' });
    await sendWhatsApp(phone, 'Please enter your *full name* for the order:', vendorId);
    return;
  }
  if (lower === 'timings') {
    await sendTimings(phone, vendorId);
    return;
  }

  // edit N / remove N from cart
  if (/^edit \d+$/.test(lower)) {
    const idx = parseInt(lower.split(' ')[1]) - 1;
    const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);
    if (idx < 0 || idx >= cart.length) { await sendWhatsApp(phone, '❌ Invalid item number.', vendorId); return; }
    await updateSession(phone, vendorId, { state: 'SELECT_QTY', pending_item_id: `cart_${idx}` });
    await sendWhatsApp(phone, `Editing: *${cart[idx].name}*\nEnter new quantity (0 to remove):`, vendorId);
    return;
  }
  if (/^remove \d+$/.test(lower)) {
    const idx = parseInt(lower.split(' ')[1]) - 1;
    const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);
    if (idx < 0 || idx >= cart.length) { await sendWhatsApp(phone, '❌ Invalid item number.', vendorId); return; }
    cart.splice(idx, 1);
    const { saveCart } = require('../../helpers/session');
    await saveCart(phone, vendorId, cart);
    if (!cart.length) {
      await updateSession(phone, vendorId, { state: 'WELCOME' });
      await sendWhatsApp(phone, '🛒 Cart is now empty. Send *menu* to start again.', vendorId);
    } else {
      await sendCartSummaryButtons(phone, cart, vendorId);
    }
    return;
  }

  switch (state) {
    case 'WELCOME':
    case 'CATEGORY_SELECT':
      await sendCategoryMenu(phone, vendorId);
      break;

    case 'SELECT_ADDON': {
      const [items] = await db.query('SELECT * FROM menu_items WHERE id = ? AND vendor_id = ?', [session.pending_item_id, vendorId]);
      const [allAddons] = await db.query('SELECT * FROM item_addons WHERE item_id = ? AND is_active = 1 ORDER BY sort_order, name', [session.pending_item_id]);

      let selectedAddonIds = null;
      if (lower !== 'skip') {
        const nums = lower.split(/\s+/).map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 1 && n <= allAddons.length);
        if (!nums.length) {
          await sendWhatsApp(phone, '❌ Invalid selection. Enter numbers like *1 3* or type *skip*.', vendorId);
          return;
        }
        selectedAddonIds = nums.map(n => allAddons[n - 1].id).join(',');
      }

      await updateSession(phone, vendorId, { pending_addons: selectedAddonIds, state: 'SELECT_QTY' });
      await sendWhatsApp(phone, `*${items[0]?.name}* — ₹${items[0]?.price}\n\nHow many do you want? (Enter quantity)`, vendorId);
      break;
    }

    case 'SELECT_QTY': {
      const qty = parseInt(text);
      if (isNaN(qty) || qty < 0) {
        await sendWhatsApp(phone, '❌ Please enter a valid quantity (number).', vendorId);
        return;
      }
      await addToCart(phone, qty, session, vendorId);
      break;
    }

    case 'GET_NAME': {
      if (text.trim().length < 2) { await sendWhatsApp(phone, '❌ Please enter a valid name.', vendorId); return; }
      await updateSession(phone, vendorId, { customer_name: text.trim(), state: 'GET_PHONE' });
      await sendWhatsApp(phone, `Thanks, *${text.trim()}*! 📱 Please enter your *10-digit mobile number*:`, vendorId);
      break;
    }

    case 'GET_PHONE': {
      const digits = text.replace(/\D/g, '');
      if (digits.length !== 10) { await sendWhatsApp(phone, '❌ Please enter a valid *10-digit* mobile number.\n\nExample: *9876543210*', vendorId); return; }
      await updateSession(phone, vendorId, { customer_phone: digits, state: 'DELIVERY_TYPE' });

      const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : session.cart;
      const couponEnabled = await isFeatureEnabled('coupon_system', vendorId);
      const [coupons] = await db.query('SELECT id FROM coupons WHERE vendor_id = ? AND is_active = 1 LIMIT 1', [vendorId]);

      if (couponEnabled && coupons.length) {
        await sendButtonMessage(phone, '🏷️ Do you have a coupon code?',
          [{ id: 'btn_yes_coupon', title: '✅ Yes, I have one' }, { id: 'btn_no_coupon', title: '❌ No, skip' }],
          vendorId);
        await updateSession(phone, vendorId, { state: 'DELIVERY_TYPE' });
      } else {
        await askDeliveryType(phone, vendorId);
      }
      break;
    }

    case 'ASK_COUPON': {
      const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : session.cart;
      const total = cartTotal(cart);
      const { valid, discount, coupon, message } = await validateCoupon(text.trim(), phone, total, vendorId);
      if (!valid) {
        await sendWhatsApp(phone, message + '\n\nEnter another code or type *skip* to continue.', vendorId);
        if (lower === 'skip') await askDeliveryType(phone, vendorId);
        return;
      }
      await updateSession(phone, vendorId, { pending_coupon: coupon.code, pending_discount: discount });
      await sendWhatsApp(phone, `✅ Coupon *${coupon.code}* applied! You save ₹${discount}`, vendorId);
      await askDeliveryType(phone, vendorId);
      break;
    }

    case 'GET_ADDRESS': {
      const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : session.cart;
      const total = cartTotal(cart);
      const dc = await calculateDeliveryCharge(total, vendorId);
      await updateSession(phone, vendorId, { temp_address: text.trim(), delivery_charge: dc, state: 'CHOOSE_PAYMENT' });

      const discount = parseFloat(session.pending_discount) || 0;
      const breakdown = await orderBreakdown(cart, discount, dc, vendorId, session.pending_coupon);
      const eta = await getSetting('estimated_time', vendorId);
      const codEnabled = await getSetting('cod_enabled', vendorId);
      const onlineEnabled = await getSetting('online_payment_enabled', vendorId);

      const body =
        `🛒 *Order Summary*\n${cartSummary(cart)}\n\n` +
        `💰 Subtotal: ₹${breakdown.subtotal}\n` +
        (breakdown.discount > 0 ? `🏷️ Discount: -₹${breakdown.discount}\n` : '') +
        (breakdown.delivery > 0 ? `🚚 Delivery: ₹${breakdown.delivery}\n` : `🚚 Delivery: *FREE*\n`) +
        (breakdown.gst > 0 ? `📊 GST: ₹${breakdown.gst}\n` : '') +
        `\n💵 *Total: ₹${breakdown.total}*\n⏱️ ETA: ${eta} mins\n\nChoose payment method:`;

      const buttons = [];
      if (onlineEnabled === '1') buttons.push({ id: 'pay_online', title: '💳 Pay Online' });
      if (codEnabled === '1') buttons.push({ id: 'pay_cod', title: '💵 Cash on Delivery' });

      await sendButtonMessage(phone, body, buttons, vendorId);
      break;
    }

    default:
      await sendWhatsApp(phone, 'Send *menu* to browse our food. 🍽️', vendorId);
  }
}

async function askDeliveryType(phone, vendorId) {
  await updateSession(phone, vendorId, { state: 'GET_ADDRESS' });
  await sendButtonMessage(phone, '🚚 How would you like to receive your order?',
    [{ id: 'btn_delivery', title: '🚚 Delivery' }, { id: 'btn_pickup', title: '🏃 Pickup' }],
    vendorId);
}

async function sendTimings(phone, vendorId) {
  const [schedule] = await db.query(
    'SELECT * FROM store_schedule WHERE vendor_id = ? ORDER BY day_of_week', [vendorId]);
  if (!schedule.length) { await sendWhatsApp(phone, 'Store timings not available.', vendorId); return; }
  const lines = schedule.map(s =>
    `${s.day_name}: ${s.is_open ? `${s.open_time.substring(0,5)} - ${s.close_time.substring(0,5)}` : 'Closed'}`
  ).join('\n');
  await sendWhatsApp(phone, `🕐 *Store Timings*\n\n${lines}`, vendorId);
}

module.exports = { handleTextState };
