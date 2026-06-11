-- ============================================================
-- SQL Migration for Platform Shared Directory Mode
-- Run on server: mysql -u root -pOfficial@12345 food_bot < migrate_shared_directory.sql
-- ============================================================

-- 1. Add selected_vendor_id column to sessions table
ALTER TABLE sessions ADD COLUMN selected_vendor_id INT DEFAULT NULL;
ALTER TABLE sessions ADD CONSTRAINT fk_sessions_selected_vendor FOREIGN KEY (selected_vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;

-- 2. Insert the platform directory dummy vendor
INSERT INTO vendors (name, email, password, is_active)
SELECT 'Platform Directory', 'platform@directory.system', 'PLATFORM_DUMMY_PASSWORD', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE email = 'platform@directory.system');

-- 3. Save platform vendor ID in platform_settings
INSERT INTO platform_settings (setting_key, setting_value)
SELECT 'platform_vendor_id', CAST(id AS CHAR)
FROM vendors
WHERE email = 'platform@directory.system'
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- 4. Add platform_shared_phone_id key in platform_settings if not exists
INSERT IGNORE INTO platform_settings (setting_key, setting_value)
VALUES ('platform_shared_phone_id', '');

-- 5. Insert default restaurant_city setting for existing vendors
INSERT IGNORE INTO settings (vendor_id, setting_key, setting_value, description)
SELECT id, 'restaurant_city', '', 'City where the restaurant is located'
FROM vendors
WHERE email != 'platform@directory.system';

SELECT 'Shared Directory Mode migration complete!' AS status;
