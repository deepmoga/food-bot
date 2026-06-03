-- ============================================================
-- Platform Settings Migration — run once on server
-- mysql -u root -pOfficial@12345 food_bot < migrate_platform_settings.sql
-- ============================================================

-- Platform-level key-value settings (for super admin)
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fix existing trial subscriptions: set end_date to 1 month from creation if NULL
UPDATE vendor_subscriptions
SET end_date = DATE_ADD(start_date, INTERVAL 1 MONTH)
WHERE billing_type = 'trial' AND end_date IS NULL;

SELECT 'Platform settings migration complete!' AS status;
