const axios = require('axios');
const db = require('../config/db');
const { getPlatformSetting } = require('./platformSettings');
const { getSetting } = require('./settings');

const BASE = 'https://graph.facebook.com/v18.0';

// Get vendor recipients based on filter
async function getRecipients(vendorId, filter) {
  let query, params = [vendorId];

  // Also exclude opted-out customers
  const optoutClause = `AND phone NOT IN (SELECT phone FROM broadcast_optouts WHERE vendor_id=?)`;

  switch (filter) {
    case 'last_7':
      query = `SELECT DISTINCT phone FROM sessions WHERE vendor_id=? AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) ${optoutClause}`;
      params.push(vendorId);
      break;
    case 'last_30':
      query = `SELECT DISTINCT phone FROM sessions WHERE vendor_id=? AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ${optoutClause}`;
      params.push(vendorId);
      break;
    case 'last_3months':
      query = `SELECT DISTINCT phone FROM orders WHERE vendor_id=? AND order_status != 'cancelled' AND created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH) ${optoutClause}`;
      params.push(vendorId);
      break;
    case 'ordered_3plus':
      query = `SELECT DISTINCT phone FROM orders WHERE vendor_id=? GROUP BY phone HAVING COUNT(*)>=3 AND phone NOT IN (SELECT phone FROM broadcast_optouts WHERE vendor_id=?)`;
      params.push(vendorId);
      break;
    default: // 'all'
      query = `SELECT DISTINCT phone FROM sessions WHERE vendor_id=? ${optoutClause}`;
      params.push(vendorId);
  }

  const [rows] = await db.query(query, params);
  return rows.map(r => r.phone);
}

// Count recipients for preview
async function countRecipients(vendorId, filter) {
  const recipients = await getRecipients(vendorId, filter);
  return recipients.length;
}

// Send one template message to a phone number
async function sendTemplateMessage(phone, template, variableValues, imageUrl, vendorId) {
  const [platformToken, vendorToken, phoneId] = await Promise.all([
    getPlatformSetting('platform_whatsapp_token'),
    db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='whatsapp_token'", [vendorId])
      .then(([r]) => r[0]?.setting_value || ''),
    db.query("SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='whatsapp_phone_id'", [vendorId])
      .then(([r]) => r[0]?.setting_value || '')
  ]);

  const token = (vendorToken && vendorToken.trim()) ? vendorToken.trim() : platformToken;
  const variables = JSON.parse(template.variables_json || '[]');

  const components = [];

  // Header component (image)
  if (template.header_type === 'image' && imageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: imageUrl } }]
    });
  }

  // Body component with variable values
  if (variableValues && variableValues.length > 0) {
    components.push({
      type: 'body',
      parameters: variableValues.map(val => ({ type: 'text', text: String(val) }))
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: template.meta_name,
      language: { code: template.language || 'en' },
      components: components.length > 0 ? components : undefined
    }
  };

  await axios.post(
    `${BASE}/${phoneId}/messages`,
    payload,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
}

// Run a broadcast campaign
async function runCampaign(campaignId) {
  const [[campaign]] = await db.query(
    'SELECT bc.*, bt.meta_name, bt.header_type, bt.variables_json, bt.language FROM broadcast_campaigns bc JOIN broadcast_templates bt ON bt.id=bc.template_id WHERE bc.id=?',
    [campaignId]
  );
  if (!campaign) return;

  await db.query("UPDATE broadcast_campaigns SET status='sending', started_at=NOW() WHERE id=?", [campaignId]);

  const recipients = await getRecipients(campaign.vendor_id, campaign.recipient_filter);
  const variableValues = JSON.parse(campaign.variable_values || '[]');
  let sent = 0, failed = 0;

  for (const phone of recipients) {
    try {
      await sendTemplateMessage(phone, campaign, variableValues, campaign.image_url, campaign.vendor_id);
      await db.query('INSERT INTO broadcast_logs (campaign_id, vendor_id, phone, status) VALUES (?,?,?,?)',
        [campaignId, campaign.vendor_id, phone, 'sent']);
      sent++;
      // Small delay to avoid rate limiting (1 msg per 100ms)
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      await db.query('INSERT INTO broadcast_logs (campaign_id, vendor_id, phone, status, error_msg) VALUES (?,?,?,?,?)',
        [campaignId, campaign.vendor_id, phone, 'failed', e.response?.data?.error?.message || e.message]);
      failed++;
    }
  }

  await db.query(
    "UPDATE broadcast_campaigns SET status='done', sent_count=?, failed_count=?, completed_at=NOW() WHERE id=?",
    [sent, failed, campaignId]
  );
}

module.exports = { getRecipients, countRecipients, runCampaign, sendTemplateMessage };
