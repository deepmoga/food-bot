-- ============================================================
-- Subscription System Migration — run once on server
-- mysql -u root -pOfficial@12345 food_bot < migrate_subscription.sql
-- ============================================================

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  msg_count INT NOT NULL,
  price_monthly DECIMAL(10,2) NOT NULL,
  price_yearly DECIMAL(10,2) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO plans (id, name, description, msg_count, price_monthly, price_yearly, sort_order) VALUES
  (1, 'Starter',  '500 conversation windows/month',  500,   499.00,  4999.00, 1),
  (2, 'Growth',   '2000 conversation windows/month', 2000, 1299.00, 12999.00, 2),
  (3, 'Pro',      '5000 conversation windows/month', 5000, 2499.00, 24999.00, 3);

-- Vendor subscriptions
CREATE TABLE IF NOT EXISTS vendor_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  plan_id INT NULL,
  plan_name VARCHAR(100) DEFAULT 'Trial',
  billing_type ENUM('trial','monthly','yearly') DEFAULT 'trial',
  messages_total INT DEFAULT 50,
  messages_used INT DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('active','expired','suspended') DEFAULT 'active',
  alert_80_sent TINYINT(1) DEFAULT 0,
  alert_100_sent TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vendor_sub (vendor_id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Subscription payments
CREATE TABLE IF NOT EXISTS subscription_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  plan_id INT NOT NULL,
  plan_name VARCHAR(100),
  billing_type ENUM('monthly','yearly') NOT NULL,
  messages_added INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  razorpay_order_id VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  status ENUM('pending','paid','failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Conversation windows
CREATE TABLE IF NOT EXISTS conversation_windows (
  vendor_id INT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  window_opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vendor_id, phone),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Give existing vendors 50 trial messages (if they don't have a subscription yet)
INSERT IGNORE INTO vendor_subscriptions (vendor_id, plan_name, billing_type, messages_total, messages_used, start_date, end_date, status)
SELECT id, 'Trial', 'trial', 50, 0, CURDATE(), NULL, 'active'
FROM vendors;

SELECT 'Migration complete!' AS status;
