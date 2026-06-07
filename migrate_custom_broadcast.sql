-- ============================================================
-- Migration: Add custom recipient phones column for custom broadcasts
-- Run: mysql -u root -pOfficial@12345 food_bot < migrate_custom_broadcast.sql
-- ============================================================

ALTER TABLE broadcast_campaigns ADD COLUMN recipient_phones LONGTEXT NULL AFTER variable_values;

SELECT 'Custom broadcast migration complete!' AS status;
