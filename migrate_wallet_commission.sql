-- ============================================================
-- Vendor Wallet: platform commission on FoodBot-gateway payments
-- Adds commission_amount + net_amount to vendor_wallet_transactions,
-- and a default platform_commission_percent setting.
-- Idempotent — safe to run on every deploy.
-- ============================================================

-- commission_amount column
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_wallet_transactions' AND COLUMN_NAME = 'commission_amount'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE vendor_wallet_transactions ADD COLUMN commission_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER amount',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- net_amount column (amount - commission_amount, what vendor is actually owed)
SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_wallet_transactions' AND COLUMN_NAME = 'net_amount'
);
SET @sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE vendor_wallet_transactions ADD COLUMN net_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER commission_amount',
  'SELECT 1');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- Backfill net_amount for existing rows (only meaningful on first run, when
-- commission_amount is still 0 for everything — net = full amount)
UPDATE vendor_wallet_transactions SET net_amount = amount WHERE net_amount = 0 AND commission_amount = 0;

-- Default platform commission percentage (0% until superadmin configures it)
INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('platform_commission_percent', '0')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
