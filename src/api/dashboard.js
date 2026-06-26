const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/', async (req, res) => {
  const vendorId = req.vendorId;

  const [[stats]] = await db.query(`
    SELECT
      COUNT(CASE WHEN DATE(created_at)=CURDATE() THEN 1 END) as today_orders,
      COUNT(CASE WHEN order_status='waiting' THEN 1 END) as pending_orders,
      COUNT(CASE WHEN order_status IN ('confirmed','preparing','ready','out_for_delivery') THEN 1 END) as active_orders,
      SUM(CASE WHEN DATE(created_at)=CURDATE() AND order_status!='cancelled' THEN total ELSE 0 END) as today_revenue,
      SUM(CASE WHEN order_status!='cancelled' THEN total ELSE 0 END) as total_revenue,
      COUNT(CASE WHEN DATE(created_at)=CURDATE() AND order_status='cancelled' THEN 1 END) as today_cancelled
    FROM orders WHERE vendor_id = ?`, [vendorId]);

  const [weeklyRows] = await db.query(`
    SELECT DATE(created_at) as date,
      COUNT(*) as orders,
      SUM(CASE WHEN order_status!='cancelled' THEN total ELSE 0 END) as revenue
    FROM orders WHERE vendor_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY DATE(created_at) ORDER BY date`, [vendorId]);

  const [popularRows] = await db.query(
    'SELECT items FROM orders WHERE vendor_id=? AND order_status!="cancelled" AND DATE(created_at)=CURDATE()',
    [vendorId]
  );
  const itemSales = {};
  for (const row of popularRows) {
    try {
      const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
      for (const item of items) {
        if (!itemSales[item.name]) itemSales[item.name] = { name: item.name, qty: 0, revenue: 0 };
        itemSales[item.name].qty += item.qty;
        const addonPrice = (item.addons || []).reduce((s, a) => s + (a.price || 0), 0);
        itemSales[item.name].revenue += (item.price + addonPrice) * item.qty;
      }
    } catch (_) {}
  }
  const popularItems = Object.values(itemSales).sort((a, b) => b.qty - a.qty).slice(0, 10);

  const [recentOrders] = await db.query(
    `SELECT id, order_number, customer_name, total, order_status, payment_method, created_at
     FROM orders WHERE vendor_id=? ORDER BY id DESC LIMIT 5`, [vendorId]
  );

  res.json({
    stats: {
      today_orders: stats.today_orders || 0,
      pending_orders: stats.pending_orders || 0,
      active_orders: stats.active_orders || 0,
      today_revenue: parseFloat(stats.today_revenue) || 0,
      total_revenue: parseFloat(stats.total_revenue) || 0,
      today_cancelled: stats.today_cancelled || 0
    },
    weekly: weeklyRows,
    popular_items: popularItems,
    recent_orders: recentOrders
  });
});

module.exports = router;
