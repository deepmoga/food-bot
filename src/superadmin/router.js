const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { requireSuperAuth } = require('./middleware/auth');

const FEATURE_KEYS = ['coupon_system','online_payment','delivery_boys','gst','bill_generation','review_request','store_schedule','broadcast'];
const FEATURE_LABELS = {
  coupon_system: '🏷️ Coupon System',
  online_payment: '💳 Online Payment',
  delivery_boys: '🛵 Delivery Boys',
  gst: '📊 GST',
  bill_generation: '🧾 Bill Generation',
  review_request: '⭐ Review Request',
  store_schedule: '🕐 Store Schedule',
  broadcast: '📢 Broadcast (WhatsApp Marketing)'
};

// LOGIN
router.get('/login', (req, res) => res.render('superadmin/views/login', { error: null }));

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === process.env.SUPER_ADMIN_EMAIL && password === process.env.SUPER_ADMIN_PASS) {
    req.session.isSuperAdmin = true;
    return res.redirect('/superadmin');
  }
  res.render('superadmin/views/login', { error: 'Invalid credentials.' });
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/superadmin/login'); });

router.use(requireSuperAuth);

// DASHBOARD
router.get('/', async (req, res) => {
  const [vendors] = await db.query('SELECT v.*, (SELECT COUNT(*) FROM orders o WHERE o.vendor_id=v.id) as order_count, (SELECT COUNT(*) FROM orders o WHERE o.vendor_id=v.id AND DATE(o.created_at)=CURDATE()) as today_orders FROM vendors v ORDER BY v.id DESC');
  const [[globalStats]] = await db.query(`SELECT COUNT(*) as total_orders, SUM(total) as total_revenue FROM orders WHERE order_status != 'cancelled'`);
  res.render('superadmin/views/dashboard', { vendors, globalStats });
});

// VENDORS LIST
router.get('/vendors', async (req, res) => {
  const [vendors] = await db.query('SELECT * FROM vendors ORDER BY id DESC');
  const [subs] = await db.query('SELECT * FROM vendor_subscriptions');
  const [credits] = await db.query('SELECT * FROM broadcast_credits');
  const subMap = {}, creditMap = {};
  for (const s of subs) subMap[s.vendor_id] = s;
  for (const c of credits) creditMap[c.vendor_id] = c.balance;
  for (const v of vendors) {
    v.sub = subMap[v.id] || null;
    v.broadcast_credits = creditMap[v.id] || 0;
  }
  res.render('superadmin/views/vendors', { vendors, error: null, success: null, query: req.query });
});

// CREATE VENDOR
router.post('/vendors/create', async (req, res) => {
  const { name, email, password, trial_messages, payment_gateway_mode } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const gatewayMode = payment_gateway_mode === 'own' ? 'own' : 'platform';
    const [result] = await db.query('INSERT INTO vendors (name, email, password, payment_gateway_mode) VALUES (?,?,?,?)', [name, email, hashed, gatewayMode]);
    const vendorId = result.insertId;
    await db.query('CALL setup_vendor_defaults(?)', [vendorId]);
    // Auto-generate unique verify token for this vendor
    const crypto = require('crypto');
    const uniqueVerifyToken = 'fb_verify_' + crypto.randomBytes(16).toString('hex');
    await db.query(
      "UPDATE settings SET setting_value=? WHERE vendor_id=? AND setting_key='verify_token'",
      [uniqueVerifyToken, vendorId]
    );
    // Create trial subscription with 50 free messages (or super admin's chosen amount)
    const trialCount = parseInt(trial_messages) || 50;
    // Trial expires in 1 month
    await db.query(
      `INSERT INTO vendor_subscriptions (vendor_id, plan_name, billing_type, messages_total, messages_used, start_date, end_date, status)
       VALUES (?, 'Trial', 'trial', ?, 0, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 MONTH), 'active')`,
      [vendorId, trialCount]
    );
    res.redirect('/superadmin/vendors?success=1');
  } catch (e) {
    const [vendors] = await db.query('SELECT * FROM vendors ORDER BY id DESC');
    res.render('superadmin/views/vendors', { vendors, error: 'Email already exists or error creating vendor.', success: null, query: {} });
  }
});

// TOGGLE VENDOR
router.post('/vendors/:id/toggle', async (req, res) => {
  await db.query('UPDATE vendors SET is_active=NOT is_active WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/vendors');
});

// CHANGE PAYMENT GATEWAY MODE (platform vs own)
router.post('/vendors/:id/payment-mode', async (req, res) => {
  const mode = req.body.payment_gateway_mode === 'own' ? 'own' : 'platform';
  await db.query('UPDATE vendors SET payment_gateway_mode=? WHERE id=?', [mode, req.params.id]);
  res.redirect('/superadmin/vendors?success=1');
});

// DELETE VENDOR
router.post('/vendors/:id/delete', async (req, res) => {
  await db.query('DELETE FROM vendors WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/vendors');
});

// RESET PASSWORD
router.post('/vendors/:id/reset-password', async (req, res) => {
  const { new_password } = req.body;
  const hashed = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE vendors SET password=? WHERE id=?', [hashed, req.params.id]);
  res.redirect('/superadmin/vendors?success=1');
});

// FEATURES PAGE
router.get('/vendors/:id/features', async (req, res) => {
  const vendorId = req.params.id;
  const [vendors] = await db.query('SELECT * FROM vendors WHERE id=?', [vendorId]);
  if (!vendors.length) return res.redirect('/superadmin/vendors');

  const [featureRows] = await db.query('SELECT feature_key, is_enabled FROM vendor_features WHERE vendor_id=?', [vendorId]);
  const featureMap = {};
  for (const f of featureRows) featureMap[f.feature_key] = f.is_enabled === 1;

  res.render('superadmin/views/features', { vendor: vendors[0], featureMap, FEATURE_KEYS, FEATURE_LABELS, query: req.query });
});

router.post('/vendors/:id/features', async (req, res) => {
  const vendorId = req.params.id;
  for (const key of FEATURE_KEYS) {
    const enabled = req.body[key] === '1' ? 1 : 0;
    await db.query(
      'INSERT INTO vendor_features (vendor_id, feature_key, is_enabled) VALUES (?,?,?) ON DUPLICATE KEY UPDATE is_enabled=?',
      [vendorId, key, enabled, enabled]
    );
  }
  res.redirect(`/superadmin/vendors/${vendorId}/features?saved=1`);
});

// MANUAL BROADCAST CREDITS ADD
router.post('/vendors/:id/add-credits', async (req, res) => {
  const vendorId = req.params.id;
  const credits = parseInt(req.body.credits) || 0;
  const note = req.body.note || 'Manual add by super admin';
  if (credits > 0) {
    await db.query(
      `INSERT INTO broadcast_credits (vendor_id, balance, total_bought) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE balance=balance+?, total_bought=total_bought+?`,
      [vendorId, credits, credits, credits, credits]
    );
    await db.query(
      `INSERT INTO credit_purchases (vendor_id, credits, amount, status, added_by, note)
       VALUES (?,?,0,'paid','manual',?)`,
      [vendorId, credits, note]
    );
  }
  res.redirect('/superadmin/vendors?success=1');
});

// MANUAL TOP-UP — add messages to a vendor
router.post('/vendors/:id/topup', async (req, res) => {
  const vendorId = req.params.id;
  const { messages } = req.body;
  const count = parseInt(messages) || 0;
  if (count > 0) {
    // Upsert subscription if not exists
    await db.query(
      `INSERT INTO vendor_subscriptions (vendor_id, plan_name, billing_type, messages_total, messages_used, start_date, status)
       VALUES (?, 'Manual Top-up', 'trial', ?, 0, CURDATE(), 'active')
       ON DUPLICATE KEY UPDATE
         messages_total = messages_total + VALUES(messages_total),
         status = 'active',
         alert_80_sent = 0,
         alert_100_sent = 0`,
      [vendorId, count]
    );
  }
  res.redirect('/superadmin/vendors?success=1');
});

// PLATFORM SETTINGS
router.get('/settings', async (req, res) => {
  const { getPlatformSetting } = require('../helpers/platformSettings');
  const [rzpKeyId, rzpKeySecret, rzpWebhookSecret, waToken, wabaId, platformSharedPhoneId] = await Promise.all([
    getPlatformSetting('platform_razorpay_key_id'),
    getPlatformSetting('platform_razorpay_key_secret'),
    getPlatformSetting('platform_razorpay_webhook_secret'),
    getPlatformSetting('platform_whatsapp_token'),
    getPlatformSetting('platform_waba_id'),
    getPlatformSetting('platform_shared_phone_id')
  ]);
  res.render('superadmin/views/settings', { rzpKeyId, rzpKeySecret, rzpWebhookSecret, waToken, wabaId, platformSharedPhoneId, query: req.query });
});

router.post('/settings', async (req, res) => {
  const { setPlatformSetting, clearPlatformCache } = require('../helpers/platformSettings');
  const { platform_razorpay_key_id, platform_razorpay_key_secret, platform_razorpay_webhook_secret, platform_whatsapp_token, platform_waba_id, platform_shared_phone_id } = req.body;
  await Promise.all([
    setPlatformSetting('platform_razorpay_key_id', platform_razorpay_key_id || ''),
    setPlatformSetting('platform_razorpay_key_secret', platform_razorpay_key_secret || ''),
    setPlatformSetting('platform_razorpay_webhook_secret', platform_razorpay_webhook_secret || ''),
    setPlatformSetting('platform_whatsapp_token', platform_whatsapp_token || ''),
    setPlatformSetting('platform_waba_id', platform_waba_id || ''),
    setPlatformSetting('platform_shared_phone_id', platform_shared_phone_id || '')
  ]);
  clearPlatformCache();
  res.redirect('/superadmin/settings?saved=1');
});

// ============================================================
// VENDOR WALLET (platform-gateway online payments)
// ============================================================

// List wallet transactions across all vendors, with vendor/status/date filters
router.get('/wallet', async (req, res) => {
  const { vendor_id, status, from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (vendor_id) { where += ' AND w.vendor_id = ?'; params.push(vendor_id); }
  if (status === 'pending' || status === 'settled') { where += ' AND w.settlement_status = ?'; params.push(status); }
  if (from) { where += ' AND DATE(w.created_at) >= ?'; params.push(from); }
  if (to) { where += ' AND DATE(w.created_at) <= ?'; params.push(to); }

  const [rows] = await db.query(
    `SELECT w.*, v.name as vendor_name
     FROM vendor_wallet_transactions w
     JOIN vendors v ON v.id = w.vendor_id
     WHERE ${where}
     ORDER BY w.id DESC LIMIT 500`,
    params
  );

  const [[totals]] = await db.query(
    `SELECT
       SUM(amount) as total_amount,
       SUM(CASE WHEN settlement_status='pending' THEN amount ELSE 0 END) as pending_amount,
       SUM(CASE WHEN settlement_status='settled' THEN amount ELSE 0 END) as settled_amount
     FROM vendor_wallet_transactions w WHERE ${where}`,
    params
  );

  const [vendors] = await db.query("SELECT id, name FROM vendors WHERE payment_gateway_mode='platform' ORDER BY name");

  res.render('superadmin/views/wallet', { rows, totals, vendors, query: req.query });
});

// Mark one transaction settled/pending
router.post('/wallet/:id/settle', async (req, res) => {
  const status = req.body.settlement_status === 'pending' ? 'pending' : 'settled';
  await db.query(
    `UPDATE vendor_wallet_transactions
     SET settlement_status=?, settled_at=${status === 'settled' ? 'NOW()' : 'NULL'}
     WHERE id=?`,
    [status, req.params.id]
  );
  res.redirect('back');
});

// Bulk-settle all pending transactions for a vendor
router.post('/wallet/settle-all', async (req, res) => {
  const { vendor_id } = req.body;
  if (vendor_id) {
    await db.query(
      "UPDATE vendor_wallet_transactions SET settlement_status='settled', settled_at=NOW() WHERE vendor_id=? AND settlement_status='pending'",
      [vendor_id]
    );
  }
  res.redirect('back');
});

// ============================================================
// BROADCAST TEMPLATES
// ============================================================

// List all templates
router.get('/templates', async (req, res) => {
  const [templates] = await db.query('SELECT * FROM broadcast_templates ORDER BY id DESC');
  res.render('superadmin/views/templates', { templates, query: req.query });
});

// Create template (save to DB + submit to Meta)
router.post('/templates/create', async (req, res) => {
  const { display_name, meta_name, header_type, header_text, body_text, footer_text,
          has_button, button_text, button_url, variables_json } = req.body;

  // meta_name: lowercase + underscores only
  const cleanName = meta_name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  try {
    // Save to DB first as draft
    const [result] = await db.query(
      `INSERT INTO broadcast_templates
       (display_name, meta_name, header_type, header_text, body_text, footer_text,
        has_button, button_text, button_url, variables_json, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'draft')`,
      [display_name, cleanName, header_type || 'none', header_text || null,
       body_text, footer_text || null, has_button ? 1 : 0,
       button_text || null, button_url || null, variables_json || '[]']
    );
    const tplId = result.insertId;
    const [[tpl]] = await db.query('SELECT * FROM broadcast_templates WHERE id=?', [tplId]);

    // Submit to Meta
    try {
      const { submitTemplate } = require('../helpers/metaTemplates');
      const metaRes = await submitTemplate(tpl);
      await db.query(
        "UPDATE broadcast_templates SET meta_template_id=?, status='pending' WHERE id=?",
        [metaRes.id || cleanName, tplId]
      );
      res.redirect('/superadmin/templates?success=submitted');
    } catch (metaErr) {
      await db.query("UPDATE broadcast_templates SET status='draft' WHERE id=?", [tplId]);
      res.redirect('/superadmin/templates?error=' + encodeURIComponent(metaErr.response?.data?.error?.message || metaErr.message));
    }
  } catch (e) {
    res.redirect('/superadmin/templates?error=' + encodeURIComponent(e.message));
  }
});

// Sync status from Meta (refresh all + import new)
router.post('/templates/sync', async (req, res) => {
  try {
    const { syncTemplatesFromMeta } = require('../helpers/metaTemplates');
    const metaTemplates = await syncTemplatesFromMeta();

    let updated = 0, imported = 0;

    for (const mt of metaTemplates) {
      const newStatus = mt.status === 'APPROVED' ? 'approved'
                      : mt.status === 'REJECTED' ? 'rejected'
                      : mt.status === 'PAUSED'   ? 'paused'
                      : 'pending';

      // Check if already in our DB
      const [[existing]] = await db.query(
        'SELECT id FROM broadcast_templates WHERE meta_name=?', [mt.name]
      );

      if (existing) {
        // Update status
        await db.query(
          "UPDATE broadcast_templates SET status=?, rejection_reason=?, meta_template_id=? WHERE meta_name=?",
          [newStatus, mt.rejected_reason || null, mt.id, mt.name]
        );
        updated++;
      } else {
        // Import from Meta — extract body text from components
        let bodyText = '', headerType = 'none', footerText = '';
        const comps = mt.components || [];
        for (const c of comps) {
          if (c.type === 'BODY') bodyText = c.text || '';
          if (c.type === 'FOOTER') footerText = c.text || '';
          if (c.type === 'HEADER') {
            headerType = c.format === 'IMAGE' ? 'image'
                       : c.format === 'TEXT'  ? 'text' : 'none';
          }
        }
        const displayName = mt.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        await db.query(
          `INSERT IGNORE INTO broadcast_templates
           (display_name, meta_name, header_type, body_text, footer_text,
            meta_template_id, status, variables_json)
           VALUES (?,?,?,?,?,?,?,'[]')`,
          [displayName, mt.name, headerType, bodyText, footerText || null, mt.id, newStatus]
        );
        imported++;
      }
    }

    res.redirect(`/superadmin/templates?success=synced&updated=${updated}&imported=${imported}`);
  } catch (e) {
    res.redirect('/superadmin/templates?error=' + encodeURIComponent(e.message));
  }
});

// Resubmit draft template to Meta
router.post('/templates/:id/resubmit', async (req, res) => {
  const [[tpl]] = await db.query('SELECT * FROM broadcast_templates WHERE id=?', [req.params.id]);
  if (!tpl) return res.redirect('/superadmin/templates');
  try {
    const { submitTemplate, deleteMetaTemplate } = require('../helpers/metaTemplates');
    // Try to delete from Meta first (in case it exists in pending state)
    try {
      await deleteMetaTemplate(tpl.meta_name);
      console.log('[Templates] Deleted existing template from Meta before resubmit');
      await new Promise(r => setTimeout(r, 2000)); // Wait 2s after delete
    } catch (_) {
      // Ignore delete errors — might not exist
    }
    const metaRes = await submitTemplate(tpl);
    await db.query(
      "UPDATE broadcast_templates SET meta_template_id=?, status='pending' WHERE id=?",
      [metaRes.id || tpl.meta_name, req.params.id]
    );
    res.redirect('/superadmin/templates?success=submitted');
  } catch (e) {
    res.redirect('/superadmin/templates?error=' + encodeURIComponent(e.message));
  }
});

// Delete template (DB + Meta)
router.post('/templates/:id/delete', async (req, res) => {
  const [[tpl]] = await db.query('SELECT * FROM broadcast_templates WHERE id=?', [req.params.id]);
  if (!tpl) return res.redirect('/superadmin/templates');
  try {
    if (tpl.meta_template_id) {
      const { deleteMetaTemplate } = require('../helpers/metaTemplates');
      await deleteMetaTemplate(tpl.meta_name);
    }
  } catch (_) {}
  await db.query('DELETE FROM broadcast_templates WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/templates?success=deleted');
});

// PLANS — list
router.get('/plans', async (req, res) => {
  const [plans] = await db.query('SELECT * FROM plans ORDER BY sort_order, id');
  res.render('superadmin/views/plans', { plans, query: req.query });
});

// PLANS — create
router.post('/plans/create', async (req, res) => {
  const { name, description, msg_count, price_monthly, price_yearly, sort_order } = req.body;
  await db.query(
    'INSERT INTO plans (name, description, msg_count, price_monthly, price_yearly, sort_order) VALUES (?,?,?,?,?,?)',
    [name, description, msg_count, price_monthly, price_yearly, sort_order || 0]
  );
  res.redirect('/superadmin/plans?success=1');
});

// PLANS — edit
router.post('/plans/:id/edit', async (req, res) => {
  const { name, description, msg_count, price_monthly, price_yearly, sort_order } = req.body;
  await db.query(
    'UPDATE plans SET name=?, description=?, msg_count=?, price_monthly=?, price_yearly=?, sort_order=? WHERE id=?',
    [name, description, msg_count, price_monthly, price_yearly, sort_order || 0, req.params.id]
  );
  res.redirect('/superadmin/plans?success=1');
});

// PLANS — toggle active
router.post('/plans/:id/toggle', async (req, res) => {
  await db.query('UPDATE plans SET is_active=NOT is_active WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/plans');
});

// PLANS — delete
router.post('/plans/:id/delete', async (req, res) => {
  await db.query('DELETE FROM plans WHERE id=?', [req.params.id]);
  res.redirect('/superadmin/plans');
});

module.exports = router;
