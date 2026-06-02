const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { logMessage } = require('../helpers/whatsapp');
const { isStoreOpen, getClosedMessage } = require('../helpers/store');
const { handleLocation } = require('./handlers/location');
const { handleDeliveryButtons } = require('./handlers/delivery');
const { handleButton } = require('./handlers/buttons');
const { handleTextState } = require('./handlers/stateMachine');

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

    // Identify vendor by phone_number_id
    const [vendorRows] = await db.query(
      "SELECT vendor_id FROM settings WHERE setting_key = 'whatsapp_phone_id' AND setting_value = ?",
      [phoneNumberId]
    );
    if (!vendorRows.length) return;
    const vendorId = vendorRows[0].vendor_id;

    // Check vendor is active
    const [vendorCheck] = await db.query('SELECT is_active FROM vendors WHERE id = ?', [vendorId]);
    if (!vendorCheck.length || !vendorCheck[0].is_active) return;

    const msgType = message.type;

    // Handle location
    if (msgType === 'location') {
      const loc = message.location;
      await logMessage(phone, 'in', `[LOCATION] ${loc.latitude},${loc.longitude}`, vendorId);
      await handleLocation(phone, loc.latitude, loc.longitude, loc.name, loc.address, vendorId);
      return;
    }

    // Only handle text and interactive
    if (!['text', 'interactive'].includes(msgType)) return;

    const msgText = msgType === 'text' ? message.text?.body?.trim() : '';
    const replyId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '';
    const replyTitle = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';

    await logMessage(phone, 'in', msgText || replyId, vendorId);

    // Delivery boy buttons — skip store open check
    if (replyId && await handleDeliveryButtons(replyId, phone, vendorId)) return;

    // Store open/closed check — skip for universal commands
    const universalCmds = ['hi', 'hello', 'menu', 'timings', 'help'];
    if (!universalCmds.includes(msgText?.toLowerCase())) {
      const { open } = await isStoreOpen(vendorId);
      if (!open) {
        const closedMsg = await getClosedMessage(vendorId);
        await require('../helpers/whatsapp').sendWhatsApp(phone, closedMsg, vendorId);
        return;
      }
    }

    // Interactive buttons
    if (replyId) {
      await handleButton(replyId, replyTitle, phone, vendorId);
      return;
    }

    // Text state machine
    if (msgText) {
      await handleTextState(phone, msgText, vendorId);
    }
  } catch (err) {
    console.error('[Webhook] Error:', err.message, err.stack);
  }
});

module.exports = router;
