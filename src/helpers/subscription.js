const db = require('../config/db');

async function getSubscription(vendorId) {
  const [rows] = await db.query('SELECT * FROM vendor_subscriptions WHERE vendor_id = ?', [vendorId]);
  if (!rows.length) return null;
  const sub = rows[0];

  // Lazy expiry check — if end_date has passed, expire it
  if (sub.end_date && new Date(sub.end_date) < new Date() && sub.status === 'active') {
    await db.query(
      "UPDATE vendor_subscriptions SET status='expired', messages_used=0, messages_total=0 WHERE vendor_id=?",
      [vendorId]
    );
    sub.status = 'expired';
    sub.messages_used = 0;
    sub.messages_total = 0;
  }
  return sub;
}

// Called on every incoming customer message.
// Returns { allowed: bool, isNewWindow: bool, remaining: int }
async function checkAndConsumeWindow(phone, vendorId) {
  const sub = await getSubscription(vendorId);

  if (!sub || sub.status !== 'active') {
    return { allowed: false, isNewWindow: false, remaining: 0 };
  }

  const remaining = sub.messages_total - sub.messages_used;
  if (remaining <= 0) {
    if (!sub.alert_100_sent) {
      await _sendAlert(vendorId, 'exhausted');
      await db.query('UPDATE vendor_subscriptions SET alert_100_sent=1 WHERE vendor_id=?', [vendorId]);
    }
    return { allowed: false, isNewWindow: false, remaining: 0 };
  }

  // Check if an active 24-hr window exists for this customer
  const [winRows] = await db.query(
    'SELECT window_opened_at FROM conversation_windows WHERE vendor_id=? AND phone=?',
    [vendorId, phone]
  );

  let isNewWindow = false;

  if (!winRows.length) {
    await db.query(
      'INSERT INTO conversation_windows (vendor_id, phone, window_opened_at) VALUES (?,?,NOW())',
      [vendorId, phone]
    );
    isNewWindow = true;
  } else {
    const hoursSince = (Date.now() - new Date(winRows[0].window_opened_at).getTime()) / 3600000;
    if (hoursSince >= 24) {
      await db.query(
        'UPDATE conversation_windows SET window_opened_at=NOW() WHERE vendor_id=? AND phone=?',
        [vendorId, phone]
      );
      isNewWindow = true;
    }
  }

  if (!isNewWindow) {
    return { allowed: true, isNewWindow: false, remaining };
  }

  // Consume 1 message
  await db.query(
    'UPDATE vendor_subscriptions SET messages_used = messages_used + 1 WHERE vendor_id=?',
    [vendorId]
  );

  const newUsed = sub.messages_used + 1;
  const newRemaining = sub.messages_total - newUsed;
  const pct = (newUsed / sub.messages_total) * 100;

  if (pct >= 80 && !sub.alert_80_sent) {
    await _sendAlert(vendorId, '80percent');
    await db.query('UPDATE vendor_subscriptions SET alert_80_sent=1 WHERE vendor_id=?', [vendorId]);
  }

  if (newRemaining <= 0) {
    await _sendAlert(vendorId, 'exhausted');
    await db.query('UPDATE vendor_subscriptions SET alert_100_sent=1 WHERE vendor_id=?', [vendorId]);
    return { allowed: false, isNewWindow: true, remaining: 0 };
  }

  return { allowed: true, isNewWindow: true, remaining: newRemaining };
}

async function _sendAlert(vendorId, type) {
  try {
    const { sendWhatsApp } = require('./whatsapp');
    const [[phoneSetting]] = await db.query(
      "SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='restaurant_phone'",
      [vendorId]
    );
    const [[nameSetting]] = await db.query(
      "SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='restaurant_name'",
      [vendorId]
    );
    const [[baseSetting]] = await db.query(
      "SELECT setting_value FROM settings WHERE vendor_id=? AND setting_key='base_url'",
      [vendorId]
    );

    const phone = phoneSetting?.setting_value;
    if (!phone) return;

    const name = nameSetting?.setting_value || 'Restaurant';
    const topupUrl = `${baseSetting?.setting_value || ''}/admin/subscription`;

    let msg;
    if (type === '80percent') {
      msg = `⚠️ *${name} — Message Limit Alert*\n\nYou have used *80%* of your WhatsApp message quota.\n\nPlease top up soon to avoid service disruption.\n\n🔗 Manage Plan: ${topupUrl}`;
    } else {
      msg = `🚨 *${name} — Messages Exhausted!*\n\nYour WhatsApp message quota is *fully used*. New customers cannot reach your bot until you top up.\n\n🔗 Top Up Now: ${topupUrl}`;
    }

    await sendWhatsApp(phone, msg, vendorId);
  } catch (e) {
    console.error('[Subscription] Alert error:', e.message);
  }
}

module.exports = { getSubscription, checkAndConsumeWindow };
