const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/categories', async (req, res) => {
  const [categories] = await db.query(
    'SELECT * FROM categories WHERE vendor_id=? ORDER BY sort_order, name',
    [req.vendorId]
  );
  res.json(categories);
});

router.get('/items', async (req, res) => {
  const vendorId = req.vendorId;
  const catId = req.query.category_id;

  let where = 'mi.vendor_id=?';
  const params = [vendorId];
  if (catId) { where += ' AND mi.category_id=?'; params.push(catId); }

  const [items] = await db.query(
    `SELECT mi.*, c.name as category_name, c.emoji as category_emoji
     FROM menu_items mi JOIN categories c ON c.id=mi.category_id
     WHERE ${where} ORDER BY c.sort_order, mi.name`, params
  );

  const [variants] = await db.query(
    `SELECT iv.* FROM item_variants iv JOIN menu_items mi ON mi.id=iv.item_id
     WHERE mi.vendor_id=? AND iv.is_active=1 ORDER BY iv.sort_order`, [vendorId]
  );

  const [addons] = await db.query(
    `SELECT ia.* FROM item_addons ia JOIN menu_items mi ON mi.id=ia.item_id
     WHERE mi.vendor_id=? AND ia.is_active=1 ORDER BY ia.sort_order`, [vendorId]
  );

  const variantMap = {}, addonMap = {};
  for (const v of variants) { (variantMap[v.item_id] = variantMap[v.item_id] || []).push(v); }
  for (const a of addons) { (addonMap[a.item_id] = addonMap[a.item_id] || []).push(a); }

  for (const item of items) {
    item.variants = variantMap[item.id] || [];
    item.addons = addonMap[item.id] || [];
  }

  res.json(items);
});

router.post('/items/:id/toggle', async (req, res) => {
  await db.query('UPDATE menu_items SET is_available=NOT is_available WHERE id=? AND vendor_id=?',
    [req.params.id, req.vendorId]);
  const [[item]] = await db.query('SELECT id, name, is_available FROM menu_items WHERE id=?', [req.params.id]);
  res.json({ success: true, is_available: item?.is_available });
});

router.post('/categories/:id/toggle', async (req, res) => {
  await db.query('UPDATE categories SET is_active=NOT is_active WHERE id=? AND vendor_id=?',
    [req.params.id, req.vendorId]);
  const [[cat]] = await db.query('SELECT id, name, is_active FROM categories WHERE id=?', [req.params.id]);
  res.json({ success: true, is_active: cat?.is_active });
});

module.exports = router;
