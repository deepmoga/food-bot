-- Adds a column to persist which WhatsApp number/vendor a customer's conversation
-- window is actually open with at the time an order is placed (the "inbound" vendor —
-- e.g. the shared platform directory number for directory-mode customers).
--
-- Why: the previous fix used session.selected_vendor_id to figure this out at
-- notification-time (admin status change, kitchen update, delivery confirm, payment
-- confirm, review request) — but resetSession() clears selected_vendor_id right after
-- the order is placed, so by the time the admin changes the order status later, the
-- lookup no longer finds the directory session and falls back to the restaurant's own
-- (often non-functional, no open conversation window) WhatsApp number. Persisting the
-- value on the order itself at creation time fixes this permanently.
--
-- Idempotent: safe to run on every deploy.
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'msg_vendor_id'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE orders ADD COLUMN msg_vendor_id INT NULL AFTER vendor_id',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE orders SET msg_vendor_id = vendor_id WHERE msg_vendor_id IS NULL;
