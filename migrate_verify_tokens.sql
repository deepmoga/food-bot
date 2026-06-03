-- ============================================================
-- Fix duplicate verify tokens for existing vendors
-- Har vendor nu unique token milega
-- mysql -u root -pOfficial@12345 food_bot < migrate_verify_tokens.sql
-- ============================================================

-- Before fix — check karo
SELECT vendor_id, setting_value as verify_token
FROM settings
WHERE setting_key = 'verify_token'
ORDER BY vendor_id;

-- Fix: Har vendor ko unique token do
UPDATE settings
SET setting_value = CONCAT('fb_verify_', LOWER(MD5(CONCAT(vendor_id, NOW(), RAND(), vendor_id * 31337))))
WHERE setting_key = 'verify_token';

-- After fix — verify karo sab alag hain
SELECT vendor_id, setting_value as verify_token
FROM settings
WHERE setting_key = 'verify_token'
ORDER BY vendor_id;

SELECT 'Done! Sab vendors ko unique verify token mil gaya.' AS status;
