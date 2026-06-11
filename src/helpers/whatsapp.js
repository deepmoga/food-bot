const axios = require('axios');
const { getSetting } = require('./settings');
const { getPlatformSetting } = require('./platformSettings');
const db = require('../config/db');

const BASE_URL = 'https://graph.facebook.com/v18.0';

async function getWAConfig(vendorId) {
  const platformVendorIdStr = await getPlatformSetting('platform_vendor_id');
  const platformVendorId = platformVendorIdStr ? parseInt(platformVendorIdStr) : null;
  const platformSharedPhoneId = await getPlatformSetting('platform_shared_phone_id');
  const platformToken = await getPlatformSetting('platform_whatsapp_token');

  if (platformVendorId && vendorId === platformVendorId) {
    return { token: platformToken, phoneId: platformSharedPhoneId };
  }

  const [vendorToken, vendorPhoneId] = await Promise.all([
    getSetting('whatsapp_token', vendorId),
    getSetting('whatsapp_phone_id', vendorId)
  ]);
  // Use vendor's own token/phone ID if set, otherwise fall back to platform-level values
  const token = (vendorToken && vendorToken.trim()) ? vendorToken.trim() : platformToken;
  const phoneId = (vendorPhoneId && vendorPhoneId.trim()) ? vendorPhoneId.trim() : platformSharedPhoneId;
  return { token, phoneId };
}

async function sendWhatsApp(to, text, vendorId) {
  const { token, phoneId } = await getWAConfig(vendorId);
  try {
    await axios.post(
      `${BASE_URL}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    await logMessage(to, 'out', text, vendorId);
  } catch (e) {
    console.error('[WA] sendWhatsApp error:', e.response?.data || e.message);
  }
}

async function sendButtonMessage(to, body, buttons, vendorId, header = null, footer = null) {
  const { token, phoneId } = await getWAConfig(vendorId);
  const interactive = {
    type: 'button',
    body: { text: body },
    action: {
      buttons: buttons.slice(0, 3).map(b => ({
        type: 'reply',
        reply: { id: b.id, title: b.title.substring(0, 20) }
      }))
    }
  };
  if (header) interactive.header = { type: 'text', text: header };
  if (footer) interactive.footer = { text: footer };

  try {
    await axios.post(
      `${BASE_URL}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'interactive', interactive },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    await logMessage(to, 'out', `[BUTTONS] ${body}`, vendorId);
  } catch (e) {
    console.error('[WA] sendButtonMessage error:', e.response?.data || e.message);
  }
}

async function sendListMessage(to, header, body, footer, buttonLabel, sections, vendorId) {
  const { token, phoneId } = await getWAConfig(vendorId);
  const interactive = {
    type: 'list',
    header: { type: 'text', text: header },
    body: { text: body },
    footer: { text: footer },
    action: { button: buttonLabel, sections }
  };

  try {
    await axios.post(
      `${BASE_URL}/${phoneId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'interactive', interactive },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    await logMessage(to, 'out', `[LIST] ${header}`, vendorId);
  } catch (e) {
    console.error('[WA] sendListMessage error:', e.response?.data || e.message);
  }
}

// Fix 2: Direct WhatsApp location picker button
async function sendLocationRequest(to, bodyText, vendorId) {
  const { token, phoneId } = await getWAConfig(vendorId);
  try {
    await axios.post(
      `${BASE_URL}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'location_request_message',
          body: { text: bodyText },
          action: { name: 'send_location' }
        }
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    await logMessage(to, 'out', '[LOCATION REQUEST]', vendorId);
  } catch (e) {
    // Fallback if location_request_message not supported
    await sendWhatsApp(to, bodyText + '\n\nPlease use the attachment button (paperclip) to share your location.', vendorId);
  }
}

async function logMessage(phone, direction, message, vendorId) {
  try {
    await db.query(
      'INSERT INTO message_logs (vendor_id, phone, direction, message) VALUES (?,?,?,?)',
      [vendorId, phone, direction, String(message).substring(0, 2000)]
    );
  } catch (_) {}
}

module.exports = { sendWhatsApp, sendButtonMessage, sendListMessage, sendLocationRequest, logMessage, getWAConfig };
