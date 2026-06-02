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

// Routes
app.use('/webhook', require('./src/webhook/index'));
app.use('/admin', require('./src/admin/router'));
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
