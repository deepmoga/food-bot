const db = require('../../config/db');
const { getSession, updateSession, getCart, saveCart } = require('../../helpers/session');
const { getSetting } = require('../../helpers/settings');
const { sendWhatsApp, sendButtonMessage, sendListMessage, sendLocationRequest } = require('../../helpers/whatsapp');
const { cartTotal, orderBreakdown } = require('../../helpers/gst');
const { cartSummary } = require('../../helpers/order');
const { calculateDeliveryCharge } = require('../../helpers/geo');
const { isFeatureEnabled } = require('../../helpers/store');
const { placeOrder } = require('../placeOrder');

async function sendCategoryMenu(phone, vendorId) {
  const restName = await getSetting('restaurant_name', vendorId);
  const [cats] = await db.query(
    'SELECT * FROM categories WHERE vendor_id = ? AND is_active = 1 ORDER BY sort_order, name',
    [vendorId]
  );
  if (!cats.length) {
    await sendWhatsApp(phone, '❌ No menu categories available right now.', vendorId);
    return;
  }

  const rows = cats.map(c => ({
    id: `cat_${c.id}`,
    title: `${c.emoji || ''} ${c.name}`.trim(),
    description: ''
  }));

  await sendListMessage(
    phone,
    restName,
    'Browse our menu and select a category:',
    'Tap to explore',
    '🍽️ View Menu',
    [{ title: 'Categories', rows }],
    vendorId
  );
}

async function handleButton(replyId, replyTitle, phone, vendorId, profileName = null) {
  const session = await getSession(phone, vendorId, profileName);

  // --- Category selected ---
  if (replyId.startsWith('cat_')) {
    const catId = parseInt(replyId.replace('cat_', ''));
    const [items] = await db.query(
      'SELECT * FROM menu_items WHERE category_id = ? AND vendor_id = ? AND is_available = 1 ORDER BY name',
      [catId, vendorId]
    );
    if (!items.length) {
      await sendWhatsApp(phone, '❌ No items available in this category.', vendorId);
      return;
    }
    const rows = items.map(i => ({
      id: `item_${i.id}`,
      title: i.name,
      description: `₹${i.price}${i.description ? ' — ' + i.description.substring(0, 60) : ''}`
    }));
    await sendListMessage(phone, replyTitle, 'Select an item to add to cart:', '', '🛒 Select Item', [{ title: 'Items', rows }], vendorId);
    return;
  }

  // --- Item selected ---
  if (replyId.startsWith('item_')) {
    const itemId = parseInt(replyId.replace('item_', ''));
    const [items] = await db.query('SELECT * FROM menu_items WHERE id = ? AND vendor_id = ?', [itemId, vendorId]);
    if (!items.length) return;

    // Check if item has variants
    const [variants] = await db.query(
      'SELECT * FROM item_variants WHERE item_id = ? AND is_active = 1 ORDER BY sort_order, name',
      [itemId]
    );

    if (variants.length > 0) {
      await updateSession(phone, vendorId, { pending_item_id: itemId, state: 'SELECT_VARIANT', pending_addons: null, pending_variant_id: null });
      const bodyText = `*${items[0].name}*\n\nPlease select your preferred size/variant:`;
      if (variants.length <= 3) {
        const buttons = variants.map(v => ({
          id: `var_${v.id}`,
          title: `${v.name} (₹${v.price})`.substring(0, 20)
        }));
        await sendButtonMessage(phone, bodyText, buttons, vendorId);
      } else {
        const rows = variants.map(v => ({
          id: `var_${v.id}`,
          title: v.name,
          description: `Price: ₹${v.price}`
        }));
        await sendListMessage(phone, items[0].name, 'Choose size:', 'Options', '📋 Select Size', [{ title: 'Sizes', rows }], vendorId);
      }
      return;
    }

    const [addons] = await db.query(
      'SELECT * FROM item_addons WHERE item_id = ? AND is_active = 1 ORDER BY sort_order, name',
      [itemId]
    );

    await updateSession(phone, vendorId, { pending_item_id: itemId, state: addons.length ? 'SELECT_ADDON' : 'SELECT_QTY', pending_addons: null });

    if (addons.length) {
      const addonList = addons.map((a, i) => `${i + 1}. ${a.name}${a.price > 0 ? ` (+₹${a.price})` : ''}`).join('\n');
      await sendWhatsApp(phone,
        `*${items[0].name}* — ₹${items[0].price}\n\n🍴 *Available add-ons:*\n${addonList}\n\nType the numbers of add-ons you want (e.g. *1 3*)\nor type *skip* to continue without add-ons.`,
        vendorId);
    } else {
      await sendWhatsApp(phone, `*${items[0].name}* — ₹${items[0].price}\n\nHow many do you want? (Enter quantity)`, vendorId);
    }
    return;
  }

  // --- Variant selected ---
  if (replyId.startsWith('var_')) {
    const variantId = parseInt(replyId.replace('var_', ''));
    const [[variant]] = await db.query('SELECT * FROM item_variants WHERE id = ?', [variantId]);
    if (!variant) return;

    await updateSession(phone, vendorId, { pending_variant_id: variantId });

    const itemId = session.pending_item_id;
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
    return;
  }

  // --- Qty button ---
  if (replyId.startsWith('qty_')) {
    const qty = parseInt(replyId.replace('qty_', ''));
    await addToCart(phone, qty, session, vendorId);
    return;
  }

  // --- Add more / Edit cart / Confirm ---
  if (replyId === 'btn_addmore') { await sendCategoryMenu(phone, vendorId); return; }

  if (replyId === 'btn_editcart') {
    await showCartEdit(phone, session, vendorId);
    return;
  }

  if (replyId === 'btn_confirm') {
    await updateSession(phone, vendorId, { state: 'GET_NAME' });
    await sendWhatsApp(phone, `Please enter your *full name* for the order:`, vendorId);
    return;
  }

  // --- Payment ---
  if (replyId === 'pay_online' || replyId === 'pay_cod') {
    await updateSession(phone, vendorId, { payment_method: replyId === 'pay_online' ? 'online' : 'cod' });
    await placeOrder(phone, vendorId);
    return;
  }

  // --- Coupon buttons ---
  if (replyId === 'btn_yes_coupon') {
    await updateSession(phone, vendorId, { state: 'ASK_COUPON' });
    await sendWhatsApp(phone, '🏷️ Enter your coupon code:', vendorId);
    return;
  }
  if (replyId === 'btn_no_coupon') {
    await askAddress(phone, session, vendorId);
    return;
  }

  // --- Address type ---
  if (replyId === 'btn_delivery') {
    await updateSession(phone, vendorId, { state: 'GET_ADDRESS' });
    await sendAddressOptions(phone, vendorId);
    return;
  }
  if (replyId === 'btn_pickup') {
    await updateSession(phone, vendorId, { temp_address: 'Pickup', delivery_charge: 0, state: 'CHOOSE_PAYMENT' });
    await sendPaymentButtons(phone, session, 0, vendorId);
    return;
  }

  // --- Address options ---
  if (replyId === 'btn_use_saved_addr') {
    const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : session.cart;
    const total = cartTotal(cart);
    const dc = await calculateDeliveryCharge(total, vendorId);
    await updateSession(phone, vendorId, { delivery_charge: dc, state: 'CHOOSE_PAYMENT' });
    await sendPaymentButtons(phone, session, dc, vendorId);
    return;
  }
  if (replyId === 'btn_new_addr') {
    await updateSession(phone, vendorId, { state: 'GET_ADDRESS', temp_address: null });
    await sendWhatsApp(phone, '📍 Please enter your *delivery address*:', vendorId);
    return;
  }
  if (replyId === 'btn_location') {
    // Fix 2: Direct WhatsApp location picker
    await sendLocationRequest(phone, 'Please share your delivery location by tapping the button below:', vendorId);
    return;
  }

  // --- Cart edit ---
  if (replyId.startsWith('edit_')) {
    const idx = parseInt(replyId.replace('edit_', ''));
    await updateSession(phone, vendorId, { state: 'SELECT_QTY', pending_item_id: `cart_${idx}` });
    const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : session.cart;
    await sendWhatsApp(phone, `Editing: *${cart[idx]?.name}*\nEnter new quantity (0 to remove):`, vendorId);
    return;
  }
  if (replyId.startsWith('remove_')) {
    const idx = parseInt(replyId.replace('remove_', ''));
    const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);
    cart.splice(idx, 1);
    await saveCart(phone, vendorId, cart);
    if (!cart.length) {
      await updateSession(phone, vendorId, { state: 'WELCOME' });
      await sendWhatsApp(phone, '🛒 Cart is now empty. Send *menu* to start again.', vendorId);
    } else {
      await sendCartSummaryButtons(phone, cart, vendorId);
    }
    return;
  }
}

async function addToCart(phone, qty, session, vendorId) {
  const pendingId = session.pending_item_id;
  let cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);

  // Editing existing cart item
  if (String(pendingId).startsWith('cart_')) {
    const idx = parseInt(String(pendingId).replace('cart_', ''));
    if (qty <= 0) cart.splice(idx, 1);
    else cart[idx].qty = qty;
    await saveCart(phone, vendorId, cart);
    await updateSession(phone, vendorId, { pending_item_id: null, state: 'CATEGORY_SELECT' });
    if (!cart.length) {
      await updateSession(phone, vendorId, { state: 'WELCOME' });
      await sendWhatsApp(phone, '🛒 Cart is now empty. Send *menu* to start again.', vendorId);
    } else {
      await sendCartSummaryButtons(phone, cart, vendorId);
    }
    return;
  }

  const [items] = await db.query('SELECT * FROM menu_items WHERE id = ? AND vendor_id = ?', [pendingId, vendorId]);
  if (!items.length) return;
  const item = items[0];

  let itemPrice = parseFloat(item.price);
  let itemName = item.name;
  let variantId = null;

  if (session.pending_variant_id) {
    const [[variant]] = await db.query('SELECT * FROM item_variants WHERE id = ?', [session.pending_variant_id]);
    if (variant) {
      itemPrice = parseFloat(variant.price);
      itemName = `${item.name} (${variant.name})`;
      variantId = variant.id;
    }
  }

  let addons = [];
  const pendingAddons = session.pending_addons;
  if (pendingAddons) {
    const addonIds = String(pendingAddons).split(',').map(Number).filter(Boolean);
    if (addonIds.length) {
      const [addonRows] = await db.query('SELECT * FROM item_addons WHERE id IN (?)', [addonIds]);
      addons = addonRows.map(a => ({ id: a.id, name: a.name, price: parseFloat(a.price) }));
    }
  }

  // Check if same item+variant+addons already in cart
  const existingIdx = cart.findIndex(c => 
    c.id === item.id && 
    c.variant_id === variantId && 
    JSON.stringify(c.addons) === JSON.stringify(addons)
  );

  if (existingIdx >= 0) {
    cart[existingIdx].qty += qty;
  } else {
    cart.push({ 
      id: item.id, 
      name: itemName, 
      price: itemPrice, 
      qty, 
      addons, 
      variant_id: variantId 
    });
  }

  await saveCart(phone, vendorId, cart);
  await updateSession(phone, vendorId, { pending_item_id: null, pending_addons: null, pending_variant_id: null, state: 'CATEGORY_SELECT' });
  await sendCartSummaryButtons(phone, cart, vendorId);
}

async function sendCartSummaryButtons(phone, cart, vendorId) {
  const summary = cartSummary(cart);
  const total = cartTotal(cart);
  const body = `🛒 *Cart Updated!*\n\n${summary}\n\n💰 Subtotal: ₹${total.toFixed(2)}\n\nWhat would you like to do?`;
  await sendButtonMessage(phone, body,
    [{ id: 'btn_addmore', title: '➕ Add More' }, { id: 'btn_editcart', title: '✏️ Edit Cart' }, { id: 'btn_confirm', title: '✅ Proceed' }],
    vendorId);
}

async function showCartEdit(phone, session, vendorId) {
  const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);
  if (!cart.length) {
    await sendWhatsApp(phone, 'Cart is empty. Send *menu* to order.', vendorId);
    return;
  }
  await updateSession(phone, vendorId, { state: 'EDIT_CART' });
  const lines = cart.map((item, i) => {
    const addonPrice = (item.addons || []).reduce((s, a) => s + a.price, 0);
    const total = (item.price + addonPrice) * item.qty;
    return `*${i + 1}.* ${item.name} x${item.qty} — Rs.${total.toFixed(0)}`;
  }).join('\n');
  await sendWhatsApp(phone,
    `*Edit Cart*\n\n${lines}\n\n` +
    `Reply:\n` +
    `*edit 1* — item 1 ki qty badlo\n` +
    `*remove 1* — item 1 hatao\n` +
    `*confirm* — checkout karo`,
    vendorId);
}

async function askAddress(phone, session, vendorId) {
  await updateSession(phone, vendorId, { state: 'GET_ADDRESS' });
  await sendAddressOptions(phone, vendorId, session.temp_address);
}

async function sendAddressOptions(phone, vendorId, savedAddress = null) {
  const buttons = [{ id: 'btn_location', title: '📍 Share Location' }, { id: 'btn_new_addr', title: '⌨️ Type Address' }];
  if (savedAddress && savedAddress !== 'Pickup') buttons.unshift({ id: 'btn_use_saved_addr', title: '✅ Use Saved Addr' });
  await sendButtonMessage(phone, '📍 How would you like to provide your delivery address?', buttons.slice(0, 3), vendorId);
}

async function sendPaymentButtons(phone, session, deliveryCharge, vendorId) {
  const cart = typeof session.cart === 'string' ? JSON.parse(session.cart) : (session.cart || []);
  const discount = parseFloat(session.pending_discount) || 0;
  const breakdown = await orderBreakdown(cart, discount, deliveryCharge, vendorId, session.pending_coupon);
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
}

module.exports = { handleButton, addToCart, sendCategoryMenu, sendCartSummaryButtons };
