require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src'));

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'food-bot-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ===== TEST ENDPOINT — Dev only =====
const db = require('./src/config/db');
app.get('/test/last-messages', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.json([]);
  try {
    const [rows] = await db.query(
      "SELECT message, direction, created_at FROM message_logs WHERE phone = ? AND direction = 'out' ORDER BY id DESC LIMIT 5",
      [phone]
    );
    const msgs = rows.reverse().map(r => {
      const text = r.message || '';
      // Extract buttons from text if any [BUTTONS] prefix
      return { text, body: text, buttons: [] };
    });
    res.json(msgs);
  } catch (e) {
    res.json([]);
  }
});

// ===== TEMP DEBUG ENDPOINT — remove after diagnosing category-select bug =====
app.get('/test/menu-debug', async (req, res) => {
  try {
    const vendorId = parseInt(req.query.vendor_id);
    const [cats] = await db.query('SELECT id, name, is_active, sort_order FROM categories WHERE vendor_id = ?', [vendorId]);
    const [items] = await db.query('SELECT id, category_id, name, price, is_available FROM menu_items WHERE vendor_id = ?', [vendorId]);
    const [settings] = await db.query("SELECT setting_key, setting_value FROM settings WHERE vendor_id = ? AND setting_key IN ('store_open','store_closed_msg')", [vendorId]);
    const [features] = await db.query("SELECT feature_key, is_enabled FROM vendor_features WHERE vendor_id = ? AND feature_key='store_schedule'", [vendorId]);
    res.json({ vendorId, cats, items, settings, features });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get('/test/simulate-button', async (req, res) => {
  try {
    const { handleButton } = require('./src/webhook/handlers/buttons');
    const { replyId, replyTitle, phone, vendorId } = req.query;
    await handleButton(replyId, replyTitle || '', phone, parseInt(vendorId));
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message, stack: e.stack });
  }
});

// Routes
app.use('/webhook', require('./src/webhook/index'));
app.use('/admin', require('./src/admin/router'));
app.use('/kitchen', require('./src/kitchen/router'));
app.use('/superadmin', require('./src/superadmin/router'));
app.use('/bill', require('./src/routes/bill'));
app.use('/razorpay-webhook', require('./src/routes/razorpay-webhook'));
app.use('/payment-callback', require('./src/routes/payment-callback'));

// Review cron — har 5 minute check karo
cron.schedule('*/5 * * * *', async () => {
  try {
    const { sendReviewRequests } = require('./src/helpers/order');
    await sendReviewRequests();
  } catch (e) {
    console.error('[CRON] Review error:', e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Food Bot running on port ${PORT}`);
});
