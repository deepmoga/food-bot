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
app.get('/test/schema-check', async (req, res) => {
  try {
    const [cols] = await db.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'msg_vendor_id'"
    );
    const [sample] = await db.query("SELECT id, vendor_id, msg_vendor_id FROM orders ORDER BY id DESC LIMIT 3");
    res.json({ hasColumn: cols.length > 0, sample });
  } catch (e) {
    res.json({ error: e.message });
  }
});

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
