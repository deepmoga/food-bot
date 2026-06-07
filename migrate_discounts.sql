-- ============================================================
-- Migration: Add Store-wide & Happy Hour Automatic Discount Settings
-- Run: mysql -u root -pOfficial@12345 food_bot < migrate_discounts.sql
-- ============================================================

-- Insert default setting keys for existing vendors
INSERT IGNORE INTO settings (vendor_id, setting_key, setting_value, description)
SELECT id, 'store_discount_enabled', '0', 'Enable store-wide automatic discount (1=Yes, 0=No)' FROM vendors
UNION ALL
SELECT id, 'store_discount_type', 'percent', 'Store-wide discount type (percent or flat)' FROM vendors
UNION ALL
SELECT id, 'store_discount_value', '0', 'Store-wide discount value' FROM vendors
UNION ALL
SELECT id, 'happy_hour_enabled', '0', 'Enable happy hour automatic discount (1=Yes, 0=No)' FROM vendors
UNION ALL
SELECT id, 'happy_hour_type', 'percent', 'Happy hour discount type (percent or flat)' FROM vendors
UNION ALL
SELECT id, 'happy_hour_value', '0', 'Happy hour discount value' FROM vendors
UNION ALL
SELECT id, 'happy_hour_start', '16:00', 'Happy hour start time (HH:MM)' FROM vendors
UNION ALL
SELECT id, 'happy_hour_end', '19:00', 'Happy hour end time (HH:MM)' FROM vendors;

SELECT 'Discounts migration complete!' AS status;
