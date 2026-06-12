const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { logMessage } = require('../helpers/whatsapp');
const { isStoreOpen, getClosedMessage } = require('../helpers/store');
const { handleLocation } = require('./handlers/location');
const { handleDeliveryButtons } = require('./handlers/delivery');
const { handleButton } = require('./handlers/buttons');
const { handleTextState } = require('./handlers/stateMachine');
const { checkAndConsumeWindow } = require('../helpers/subscription');

// GET — webhook verification
router.get('/', async (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode !== 'subscribe') return res.sendStatus(400);

  // Find vendor by verify_token
  const [rows] = await db.query(
    "SELECT vendor_id FROM settings WHERE setting_key = 'verify_token' AND setting_value = ?",
    [token]
  );
  if (!rows.length) return res.sendStatus(403);
  res.status(200).send(challenge);
});

// POST — incoming messages
router.post('/', async (req, res) => {
  res.sendStatus(200); // Always 200 immediately

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    if (!change?.messages?.length) return;

    const phoneNumberId = change.metadata?.phone_number_id;
    const message = change.messages[0];
    const phone = message.from;
    const profileName = change.contacts?.[0]?.profile?.name || null;

    // Identify vendor mode (Platform Shared Number or Dedicated Number)
    const { getPlatformSetting } = require('../helpers/platformSettings');
    const platformSharedPhoneId = await getPlatformSetting('platform_shared_phone_id');
    const platformVendorIdStr = await getPlatformSetting('platform_vendor_id');
    const platformVendorId = platformVendorIdStr ? parseInt(platformVendorIdStr) : null;
    let vendorId;
    let isDirectoryMode = false;

    if (platformSharedPhoneId && phoneNumberId === platformSharedPhoneId) {
      isDirectoryMode = true;
      vendorId = platformVendorId;
      if (!vendorId) {
        // Self-healing: try to find or create the platform vendor
        const [[pVendor]] = await db.query('SELECT id FROM vendors WHERE email = ?', ['platform@directory.system']);
        if (pVendor) {
          vendorId = pVendor.id;
          await db.query(
            'INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['platform_vendor_id', String(vendorId), String(vendorId)]
          );
        } else {
          const bcrypt = require('bcrypt');
          const hashed = await bcrypt.hash('PLATFORM_DUMMY_PASSWORD', 10);
          const [result] = await db.query(
            'INSERT INTO vendors (name, email, password, is_active) VALUES (?, ?, ?, 1)',
            ['Platform Directory', 'platform@directory.system', hashed]
          );
          vendorId = result.insertId;
          await db.query(
            'INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['platform_vendor_id', String(vendorId), String(vendorId)]
          );
        }
      }
      if (!vendorId) {
        console.error('[Webhook] Platform vendor ID not configured in platform_settings and self-healing failed');
        return;
      }
    } else {
      // Dedicated Mode
      const [vendorRows] = await db.query(
        "SELECT vendor_id FROM settings WHERE setting_key = 'whatsapp_phone_id' AND setting_value = ?",
        [phoneNumberId]
      );
      if (!vendorRows.length) return;
      vendorId = vendorRows[0].vendor_id;
    }

    // Load session to identify if we have a selected vendor context
    const { getSession } = require('../helpers/session');
    const session = await getSession(phone, vendorId, profileName);
    const activeVendorId = session.selected_vendor_id || vendorId;

    // Check vendor is active
    const [vendorCheck] = await db.query('SELECT is_active FROM vendors WHERE id = ?', [activeVendorId]);
    if (!vendorCheck.length || !vendorCheck[0].is_active) return;

    // Check message quota (skip directory selection phase for platform vendor)
    if (activeVendorId !== platformVendorId) {
      const { allowed } = await checkAndConsumeWindow(phone, activeVendorId);
      if (!allowed) {
        await require('../helpers/whatsapp').sendWhatsApp(
          phone,
          `Sorry, our WhatsApp ordering service is temporarily unavailable due to a technical limit.\n\nPlease call us directly or visit us in person.\n\n_Service will resume once the message quota is renewed._`,
          activeVendorId
        );
        return;
      }
    }

    const msgType = message.type;

    // Handle location
    if (msgType === 'location') {
      const loc = message.location;
      await logMessage(phone, 'in', `[LOCATION] ${loc.latitude},${loc.longitude}`, activeVendorId);
      // Pass the inbound vendorId (not activeVendorId) — getSession()/sendWhatsApp() inside
      // handleLocation must use the customer's actual conversation number; it resolves
      // activeVendorId internally via session.selected_vendor_id for data lookups.
      await handleLocation(phone, loc.latitude, loc.longitude, loc.name, loc.address, vendorId);
      return;
    }

    // Only handle text and interactive
    if (!['text', 'interactive'].includes(msgType)) return;

    const msgText = msgType === 'text' ? message.text?.body?.trim() : '';
    const replyId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '';
    const replyTitle = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';

    await logMessage(phone, 'in', msgText || replyId, activeVendorId);

    // Delivery boy buttons — skip store open check
    if (replyId && await handleDeliveryButtons(replyId, phone, activeVendorId)) return;

    // Store open/closed check — skip for universal commands and platform selection
    const universalCmds = ['hi', 'hello', 'menu', 'timings', 'help', 'exit', 'change'];
    if (activeVendorId !== platformVendorId && !universalCmds.includes(msgText?.toLowerCase())) {
      const { open } = await isStoreOpen(activeVendorId);
      if (!open) {
        const closedMsg = await getClosedMessage(activeVendorId);
        // Reply via the inbound (e.g. shared platform) number, not the selected vendor's own number
        await require('../helpers/whatsapp').sendWhatsApp(phone, closedMsg, vendorId);
        return;
      }
    }

    // Interactive buttons
    if (replyId) {
      await handleButton(replyId, replyTitle, phone, vendorId, profileName);
      return;
    }

    // STOP — opt out from broadcast
    if (msgText && msgText.trim().toUpperCase() === 'STOP') {
      await db.query('INSERT IGNORE INTO broadcast_optouts (vendor_id, phone) VALUES (?,?)', [activeVendorId, phone]);
      await require('../helpers/whatsapp').sendWhatsApp(phone, 'Aapko broadcast list se remove kar diya gaya hai. ✅\n\nWapas join karne ke liye "START" bhejein.', activeVendorId);
      return;
    }

    // Text state machine
    if (msgText) {
      await handleTextState(phone, msgText, vendorId, profileName);
    }
  } catch (err) {
    console.error('[Webhook] Error:', err.message, err.stack);
  }
});

module.exports = router;
