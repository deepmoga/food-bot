-- ============================================================
-- Payment Gateway (Platform vs Own) + Vendor Wallet — migration
-- Idempotent: safe to run on every deploy.
-- ============================================================

-- 1. Ensure platform_settings table exists (in case migrate_platform_settings.sql
--    was never run on this DB).
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. vendors.payment_gateway_mode — 'platform' (FoodBot's Razorpay account is used
--    for that vendor's online payments) or 'own' (vendor's own Razorpay keys, saved
--    in their /admin/settings, are used — current/legacy behaviour).
--
--    New column defaults to 'platform'. But ALL vendors that already existed before
--    this migration ran were built around 'own' (their own Razorpay keys) — so on
--    the FIRST run only, we backfill every existing vendor to 'own'. Re-running this
--    migration must NOT touch vendors created afterwards (who may legitimately be
--    'platform'), so the backfill only happens when the column is first added.
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendors' AND COLUMN_NAME = 'payment_gateway_mode'
);

SET @add_sql = IF(@col_exists = 0,
  'ALTER TABLE vendors ADD COLUMN payment_gateway_mode ENUM(''platform'',''own'') NOT NULL DEFAULT ''platform'' AFTER is_active',
  'SELECT 1');
PREPARE stmt FROM @add_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @backfill_sql = IF(@col_exists = 0,
  'UPDATE vendors SET payment_gateway_mode = ''own''',
  'SELECT 1');
PREPARE stmt2 FROM @backfill_sql;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- 3. vendor_wallet_transactions — every successful online payment made through the
--    PLATFORM Razorpay gateway (i.e. for vendors with payment_gateway_mode='platform')
--    is logged here, so the vendor can see "kitna online payment aaya" date-wise in
--    their admin Wallet tab, and the super admin can mark amounts as settled/paid out.
CREATE TABLE IF NOT EXISTS vendor_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  order_id INT NOT NULL,
  order_number VARCHAR(40),
  amount DECIMAL(10,2) NOT NULL,
  settlement_status ENUM('pending','settled') NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_wallet_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'Payment gateway + wallet migration complete!' AS status;
