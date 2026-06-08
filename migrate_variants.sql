-- ============================================================
-- Migration: Add Menu Item Variants / Sizes System
-- mysql -u root -pOfficial@12345 food_bot < migrate_variants.sql
-- ============================================================

-- Create item_variants table
CREATE TABLE IF NOT EXISTS item_variants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  name VARCHAR(50) NOT NULL COMMENT 'e.g. Small, Medium, Large, Half, Full',
  price DECIMAL(10,2) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add pending_variant_id to sessions table
ALTER TABLE sessions ADD COLUMN pending_variant_id INT NULL AFTER pending_item_id;

SELECT 'Variants migration table and column created successfully!' AS status;
