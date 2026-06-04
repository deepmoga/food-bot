-- Add broadcast feature to all existing vendors (OFF by default)
-- Super admin manually ON karega jab credits assign kare
INSERT IGNORE INTO vendor_features (vendor_id, feature_key, is_enabled)
SELECT id, 'broadcast', 0 FROM vendors;

-- Init broadcast_credits for existing vendors (if not already done)
INSERT IGNORE INTO broadcast_credits (vendor_id, balance)
SELECT id, 0 FROM vendors;

SELECT 'Broadcast feature added to all vendors (OFF by default)' AS status;
