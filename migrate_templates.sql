-- ============================================================
-- Broadcast Templates Table
-- mysql -u root -pOfficial@12345 food_bot < migrate_templates.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS broadcast_templates (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  display_name    VARCHAR(100) NOT NULL,
  meta_name       VARCHAR(100) NOT NULL UNIQUE,
  category        VARCHAR(30)  DEFAULT 'MARKETING',
  language        VARCHAR(10)  DEFAULT 'en',
  header_type     ENUM('none','image','text') DEFAULT 'none',
  header_text     VARCHAR(60)  DEFAULT NULL,
  body_text       TEXT         NOT NULL,
  footer_text     VARCHAR(60)  DEFAULT NULL,
  has_button      TINYINT(1)   DEFAULT 0,
  button_text     VARCHAR(25)  DEFAULT NULL,
  button_url      VARCHAR(255) DEFAULT NULL,
  variables_json  TEXT         DEFAULT NULL COMMENT 'JSON: [{name, example}]',
  meta_template_id VARCHAR(50) DEFAULT NULL,
  status          ENUM('draft','pending','approved','rejected','paused') DEFAULT 'draft',
  rejection_reason TEXT        DEFAULT NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'broadcast_templates table created!' AS status;
