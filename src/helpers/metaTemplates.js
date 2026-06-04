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
    // No example needed for IMAGE header — Meta accepts without it
    components.push({
      type: 'HEADER',
      format: 'IMAGE'
    });
  } else if (tpl.header_type === 'text' && tpl.header_text) {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: tpl.header_text
    });
  }

  // BODY — strip bold markdown from variables (Meta API issue)
  const cleanBody = tpl.body_text.replace(/\*(\{\{[0-9]+\}\})\*/g, '$1');
  const variables = JSON.parse(tpl.variables_json || '[]');
  const bodyComp = { type: 'BODY', text: cleanBody };
  // Always include examples when variables exist
  const varMatches = cleanBody.match(/\{\{[0-9]+\}\}/g) || [];
  if (varMatches.length > 0) {
    const examplesArr = varMatches.map((_, i) => variables[i]?.example || `sample${i+1}`);
    bodyComp.example = { body_text: [examplesArr] };
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

  const components = buildComponents(tpl);
  const payload = {
    name: tpl.meta_name,
    language: tpl.language || 'en',
    category: tpl.category || 'MARKETING',
    components
  };

  console.log('[Templates] Submitting payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(
      `${BASE}/${wabaId}/message_templates`,
      payload,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('[Templates] Meta response:', res.data);
    return res.data;
  } catch (e) {
    const metaError = e.response?.data?.error;
    console.error('[Templates] Meta error full:', JSON.stringify(e.response?.data, null, 2));
    const msg = metaError
      ? `Meta Error ${metaError.code}: ${metaError.message}${metaError.error_data ? ' | ' + JSON.stringify(metaError.error_data) : ''}`
      : e.message;
    throw new Error(msg);
  }
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

// Delete template from Meta (by template name)
async function deleteMetaTemplate(templateName) {
  const { wabaId, token } = await getMetaConfig();
  await axios.delete(
    `${BASE}/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

module.exports = { submitTemplate, syncTemplatesFromMeta, deleteMetaTemplate };
