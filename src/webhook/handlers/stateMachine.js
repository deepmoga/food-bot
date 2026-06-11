const db = require('../../config/db');
const { getSession, updateSession } = require('../../helpers/session');
const { getSetting } = require('../../helpers/settings');
const { sendWhatsApp, sendButtonMessage, sendListMessage } = require('../../helpers/whatsapp');
const { cartTotal, orderBreakdown } = require('../../helpers/gst');
const { cartSummary } = require('../../helpers/order');
const { validateCoupon } = require('../../helpers/coupon');
const { calculateDeliveryCharge } = require('../../helpers/geo');
const { isFeatureEnabled } = require('../../helpers/store');
const { getPlatformSetting } = require('../../helpers/platformSettings');
const { sendCategoryMenu, addToCart, sendCartSummaryButtons, sendCityList, sendRestaurantList } = require('./buttons');

async function handleTextState(phone, text, vendorId, profileName = null) {
  const session = await getSession(phone, vendorId, profileName);
  const state = session.state || 'WELCOME';
  const lower = text.toLowerCase().trim();

  // Load platform details to check if we are in shared directory mode
  const platformVendorIdStr = await getPlatformSetting('platform_vendor_id');
  const platformVendorId = platformVendorIdStr ? parseInt(platformVendorIdStr) : null;
  const isPlatform = (platformVendorId && vendorId === platformVendorId);

  // Universal commands (Shared Number Directory Mode Exit/Change)
  if (isPlatform && ['exit', 'change', 'change restaurant', 'directory', 'city'].includes(lower)) {
    const { resetSession } = require('../../helpers/session');
    await resetSession(phone, vendorId);
    await updateSession(phone, vendorId, { state: 'SELECT_CITY' });
    await sendCityList(phone, vendorId);
    return;
  }

  // If in platform directory mode and haven't selected a restaurant yet
  if (isPlatform && !session.selected_vendor_id) {
    if (state === 'SELECT_CITY') {
      // Treat text as search query for City
      const [rows] = await db.query(
        `SELECT DISTINCT s.setting_value AS city
         FROM settings s
         JOIN vendors v ON v.id = s.vendor_id
         WHERE s.setting_key = 'restaurant_city'
           AND v.is_active = 1
           AND s.setting_value IS NOT NULL
           AND s.setting_value != ''
           AND s.setting_value LIKE ?`,
        [`%${text}%`]
      );

      if (rows.length === 1) {
        const matchedCity = rows[0].city.trim();
        await updateSession(phone, vendorId, { temp_address: matchedCity, state: 'SELECT_RESTAURANT' });
        await sendRestaurantList(phone, matchedCity, vendorId);
      } else if (rows.length > 1 && rows.length <= 10) {
        const listRows = rows.map(r => ({
          id: `city_${r.city.trim()}`,
          title: r.city.trim(),
          description: `View restaurants in ${r.city.trim()}`
        }));
        await sendListMessage(
          phone,
          '📍 Select City',
          `Multiple cities matched your search "${text}". Please select one:`,
          'Cities',
          '📍 Select City',
          [{ title: 'Matching Cities', rows: listRows }],
          vendorId
        );
      } else {
        await sendWhatsApp(phone, `❌ No active cities matched "${text}". Please choose from the list below:`, vendorId);
        await sendCityList(phone, vendorId);
      }
      return;
    }

    if (state === 'SELECT_RESTAURANT') {
      const selectedCity = session.temp_address;
      // Treat text as search query for Restaurant in selected city
      const [restaurants] = await db.query(
        `SELECT v.id, v.name, 
           (SELECT setting_value FROM settings WHERE vendor_id = v.id AND setting_key = 'restaurant_tagline') as tagline
         FROM vendors v
         JOIN settings s ON s.vendor_id = v.id
         WHERE s.setting_key = 'restaurant_city'
           AND s.setting_value = ?
           AND v.is_active = 1
           AND v.name LIKE ?`,
        [selectedCity, `%${text}%`]
      );

      if (restaurants.length === 1) {
        const rest = restaurants[0];
        await updateSession(phone, vendorId, { selected_vendor_id: rest.id, state: 'CATEGORY_SELECT' });
        await sendWhatsApp(phone, `Welcome to *${rest.name}*! 🏪`, vendorId);
        await sendCategoryMenu(phone, vendorId);
      } else if (restaurants.length > 1 && restaurants.length <= 10) {
        const listRows = restaurants.map(r => ({
          id: `rest_${r.id}`,
          title: r.name,
          description: r.tagline || 'Delicious food delivery'
        }));
        await sendListMessage(
          phone,
          '🏪 Select Restaurant',
          `Multiple restaurants matched your search "${text}". Please select one:`,
          'Restaurants',
          '🏪 Select Restaurant',
          [{ title: `Restaurants in ${selectedCity}`, rows: listRows }],
          vendorId
        );
      } else {
        await sendWhatsApp(phone, `❌ No restaurants found matching "${text}". Please select from the list below:`, vendorId);
        await sendRestaurantList(phone, selectedCity, vendorId);
      }
      return;
    }

    // Default entry to city selection
    await updateSession(phone, vendorId, { state: 'SELECT_CITY' });
    await sendCityList(phone, vendorId);
    return;
  }

  // Active restaurant ID context (either selected in directory mode or dedicated vendorId)
  const activeVendorId = session.selected_vendor_id || vendorId;

  // Universal commands (inside restaurant context)
  if (['hi', 'hello', 'menu', 'start'].includes(lower)) {
    await updateSession(phone, vendorId, { state: 'CATEGORY_SELECT' });
    await sendCategoryMenu(phone, vendorId);
    return;
  }
  if (lower === 'help') {
    let helpMsg = `*Help Menu*\n\n• Send *menu* to browse food\n• Send *cart* to view your cart\n• Send *cancel* to reset your order\n• Send *timings* to see store hours`;
    if (isPlatform) {
      helpMsg += `\n• Send *change* to switch to another restaurant`;
    }
    await sendWhatsApp(phone, helpMsg, vendorId);
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
    if (isPlatform) {
      // In platform mode, go back to restaurant selection or category select? 
      // Safer to go back to directory home
      await updateSession(phone, vendorId, { state: 'SELECT_CITY' });
      await sendWhatsApp(phone, 'Order cancelled.', vendorId);
      await sendCityList(phone, vendorId);
    } else {
      await sendWhatsApp(phone, 'Order cancelled. Send *menu* to start again.', vendorId);
    }
    return;
  }
  if (lower === 'confirm' && (state === 'EDIT_CART' || state === 'CATEGORY_SELECT')) {
    await updateSession(phone, vendorId, { state: 'GET_NAME' });
    await sendWhatsApp(phone, 'Please enter your *full name* for the order:', vendorId);
    return;
  }
  if (lower === 'timings') {
    await sendTimings(phone, activeVendorId, vendorId);
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

    case 'SELECT_VARIANT': {
      const itemId = session.pending_item_id;
      const [variants] = await db.query(
        'SELECT * FROM item_variants WHERE item_id = ? AND is_active = 1 ORDER BY sort_order, name',
        [itemId]
      );
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= variants.length) {
        await sendWhatsApp(phone, '❌ Invalid selection. Please enter a number from the list or tap a button.', vendorId);
        return;
      }
      const variant = variants[idx];
      await updateSession(phone, vendorId, { pending_variant_id: variant.id });

      const [[item]] = await db.query('SELECT name FROM menu_items WHERE id = ?', [itemId]);
      const itemName = item ? item.name : 'Item';

      const [addons] = await db.query(
        'SELECT * FROM item_addons WHERE item_id = ? AND is_active = 1 ORDER BY sort_order, name',
        [itemId]
      );

      if (addons.length) {
        await updateSession(phone, vendorId, { state: 'SELECT_ADDON' });
        const addonList = addons.map((a, i) => `${i + 1}. ${a.name}${a.price > 0 ? ` (+₹${a.price})` : ''}`).join('\n');
        await sendWhatsApp(phone,
          `*${itemName} (${variant.name})* — ₹${variant.price}\n\n🍴 *Available add-ons:*\n${addonList}\n\nType the numbers of add-ons you want (e.g. *1 3*)\nor type *skip* to continue without add-ons.`,
          vendorId);
      } else {
        await updateSession(phone, vendorId, { state: 'SELECT_QTY' });
        await sendWhatsApp(phone, `*${itemName} (${variant.name})* — ₹${variant.price}\n\nHow many do you want? (Enter quantity)`, vendorId);
      }
      break;
    }

    case 'SELECT_ADDON': {
      const [items] = await db.query('SELECT * FROM menu_items WHERE id = ? AND vendor_id = ?', [session.pending_item_id, activeVendorId]);
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

      let itemName = items[0]?.name || 'Item';
      let itemPrice = parseFloat(items[0]?.price || 0);
      if (session.pending_variant_id) {
        const [[variant]] = await db.query('SELECT * FROM item_variants WHERE id = ?', [session.pending_variant_id]);
        if (variant) {
          itemName = `${items[0]?.name} (${variant.name})`;
          itemPrice = parseFloat(variant.price);
        }
      }

      await sendWhatsApp(phone, `*${itemName}* — ₹${itemPrice}\n\nHow many do you want? (Enter quantity)`, vendorId);
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

      const couponEnabled = await isFeatureEnabled('coupon_system', activeVendorId);
      const [coupons] = await db.query('SELECT id FROM coupons WHERE vendor_id = ? AND is_active = 1 LIMIT 1', [activeVendorId]);

      if (couponEnabled && coupons.length) {
        await sendButtonMessage(phone, '🏷️ Do you have a coupon code?',
          [{ id: 'btn_yes_coupon', title: '✅ Yes, I have one' }, { id: 'btn_no_coupon', title: '❌ No, skip' }],
          vendorId);
      } else {
        await askDeliveryType(phone, vendorId);
      }
      break;
    }

    case 'ASK_COUPON': {
      const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : session.cart;
      const total = cartTotal(cart);
      const { valid, discount, coupon, message } = await validateCoupon(text.trim(), phone, total, activeVendorId);
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
      const dc = await calculateDeliveryCharge(total, activeVendorId);
      await updateSession(phone, vendorId, { temp_address: text.trim(), delivery_charge: dc, state: 'CHOOSE_PAYMENT' });

      const discount = parseFloat(session.pending_discount) || 0;
      const breakdown = await orderBreakdown(cart, discount, dc, activeVendorId, session.pending_coupon);
      const eta = await getSetting('estimated_time', activeVendorId);
      const codEnabled = await getSetting('cod_enabled', activeVendorId);
      const onlineEnabled = await getSetting('online_payment_enabled', activeVendorId);

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

async function sendTimings(phone, activeVendorId, platformVendorId) {
  const [schedule] = await db.query(
    'SELECT * FROM store_schedule WHERE vendor_id = ? ORDER BY day_of_week', [activeVendorId]);
  if (!schedule.length) { await sendWhatsApp(phone, 'Store timings not available.', platformVendorId); return; }
  const lines = schedule.map(s =>
    `${s.day_name}: ${s.is_open ? `${s.open_time.substring(0,5)} - ${s.close_time.substring(0,5)}` : 'Closed'}`
  ).join('\n');
  await sendWhatsApp(phone, `🕐 *Store Timings*\n\n${lines}`, platformVendorId);
}

module.exports = { handleTextState };
