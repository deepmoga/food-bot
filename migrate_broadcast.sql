-- ============================================================
-- Broadcast System Tables
-- mysql -u root -pOfficial@12345 food_bot < migrate_broadcast.sql
-- ============================================================

-- Vendor broadcast credits balance
CREATE TABLE IF NOT EXISTS broadcast_credits (
  vendor_id     INT NOT NULL PRIMARY KEY,
  balance       INT NOT NULL DEFAULT 0,
  total_bought  INT NOT NULL DEFAULT 0,
  total_used    INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Broadcast campaigns
CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id        INT NOT NULL,
  template_id      INT NOT NULL,
  template_name    VARCHAR(100),
  variable_values  TEXT COMMENT 'JSON array of variable values',
  recipient_phones LONGTEXT NULL,
  image_url        TEXT DEFAULT NULL,
  recipient_filter VARCHAR(30) DEFAULT 'all',
  recipient_count  INT DEFAULT 0,
  sent_count       INT DEFAULT 0,
  failed_count     INT DEFAULT 0,
  credits_used     INT DEFAULT 0,
  status           ENUM('pending','sending','done','failed') DEFAULT 'pending',
  scheduled_at     DATETIME NULL,
  started_at       DATETIME NULL,
  completed_at     DATETIME NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES broadcast_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-recipient log
CREATE TABLE IF NOT EXISTS broadcast_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  vendor_id   INT NOT NULL,
  phone       VARCHAR(20) NOT NULL,
  status      ENUM('sent','failed') DEFAULT 'sent',
  error_msg   TEXT NULL,
  sent_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES broadcast_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Credit purchase history
CREATE TABLE IF NOT EXISTS credit_purchases (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id           INT NOT NULL,
  credits             INT NOT NULL,
  amount              DECIMAL(10,2) NOT NULL,
  razorpay_order_id   VARCHAR(100) NULL,
  razorpay_payment_id VARCHAR(100) NULL,
  status              ENUM('pending','paid','failed') DEFAULT 'pending',
  added_by            ENUM('purchase','manual','bonus') DEFAULT 'purchase',
  note                VARCHAR(255) NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Opt-out list (customer ne STOP reply kiya)
CREATE TABLE IF NOT EXISTS broadcast_optouts (
  vendor_id   INT NOT NULL,
  phone       VARCHAR(20) NOT NULL,
  opted_out_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vendor_id, phone),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Init credits for existing vendors
INSERT IGNORE INTO broadcast_credits (vendor_id, balance)
SELECT id, 0 FROM vendors;

SELECT 'Broadcast tables created!' AS status;
