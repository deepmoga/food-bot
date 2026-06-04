const axios = require('axios');
const { getPlatformSetting } = require('./platformSettings');

const BASE = 'https://graph.facebook.com/v18.0';

// Get WABA ID and Token
async function getMetaConfig() {
  const [wabaId, token] = await Promise.all([
    getPlatformSetting('platform_waba_id'),
    getPlatformSetting('platform_whatsapp_token')
  ]);
  return { wabaId, token };
}

// Build Meta API components from our template data
function buildComponents(tpl) {
  const components = [];

  // HEADER
  if (tpl.header_type === 'image') {
    components.push({
      type: 'HEADER',
      format: 'IMAGE',
      example: { header_handle: ['https://via.placeholder.com/800x400'] }
    });
  } else if (tpl.header_type === 'text' && tpl.header_text) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: tpl.header_text
    });
  }

  // BODY
  const variables = JSON.parse(tpl.variables_json || '[]');
  const bodyExamples = variables.map(v => v.example || 'Sample text');
  const bodyComp = { type: 'BODY', text: tpl.body_text };
  if (bodyExamples.length > 0) {
    bodyComp.example = { body_text: [bodyExamples] };
  }
  components.push(bodyComp);

  // FOOTER
  if (tpl.footer_text) {
    components.push({ type: 'FOOTER', text: tpl.footer_text });
  }

  // BUTTON (URL type)
  if (tpl.has_button && tpl.button_text && tpl.button_url) {
    components.push({
      type: 'BUTTONS',
      buttons: [{
        type: 'URL',
        text: tpl.button_text,
        url: tpl.button_url
      }]
    });
  }

  return components;
}

// Submit template to Meta for approval
async function submitTemplate(tpl) {
  const { wabaId, token } = await getMetaConfig();
  if (!wabaId || !token) throw new Error('WABA ID ya Token set nahi hai platform settings mein');

  const payload = {
    name: tpl.meta_name,
    language: tpl.language || 'en',
    category: tpl.category || 'MARKETING',
    components: buildComponents(tpl)
  };

  const res = await axios.post(
    `${BASE}/${wabaId}/message_templates`,
    payload,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return res.data; // { id, status }
}

// Fetch all templates from Meta and sync status
async function syncTemplatesFromMeta() {
  const { wabaId, token } = await getMetaConfig();
  if (!wabaId || !token) throw new Error('WABA ID ya Token set nahi hai');

  const res = await axios.get(
    `${BASE}/${wabaId}/message_templates?fields=id,name,status,rejected_reason,components&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data?.data || [];
}

// Delete template from Meta
async function deleteMetaTemplate(metaTemplateId, token) {
  if (!token) {
    const cfg = await getMetaConfig();
    token = cfg.token;
  }
  const { wabaId } = await getMetaConfig();
  await axios.delete(
    `${BASE}/${wabaId}/message_templates?name=${metaTemplateId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

module.exports = { submitTemplate, syncTemplatesFromMeta, deleteMetaTemplate };
