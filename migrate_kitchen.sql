-- ============================================================
-- Migration: Add Kitchen KDS Passcode Setting
-- mysql -u root -pOfficial@12345 food_bot < migrate_kitchen.sql
-- ============================================================

-- Insert default kitchen passcode setting key for existing vendors
INSERT IGNORE INTO settings (vendor_id, setting_key, setting_value, description)
SELECT id, 'kitchen_passcode', '1234', 'Passcode for kitchen staff login (4-digits)' FROM vendors;

SELECT 'Kitchen passcode settings migration complete!' AS status;
