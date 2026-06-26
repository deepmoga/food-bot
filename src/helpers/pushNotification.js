const axios = require('axios');
const db = require('../config/db');

async function sendPushToVendor(vendorId, title, body, data = {}) {
  const [tokens] = await db.query('SELECT push_token FROM vendor_push_tokens WHERE vendor_id=?', [vendorId]);
  if (!tokens.length) return;

  const messages = tokens.map(t => ({
    to: t.push_token,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: 'orders',
  }));

  try {
    await axios.post('https://exp.host/--/api/v2/push/send', messages, {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('[Push] Error:', e.message);
  }
}

module.exports = { sendPushToVendor };
