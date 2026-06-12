-- ============================================================
-- WhatsApp Food Bot — Multi-Vendor Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS food_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE food_bot;

-- ============================================================
-- 1. vendors
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  -- 'platform' = online payments use FoodBot's (platform) Razorpay gateway;
  -- 'own' = vendor uses their own Razorpay keys (saved in /admin/settings).
  payment_gateway_mode ENUM('platform','own') NOT NULL DEFAULT 'platform',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 2. vendor_features
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_features (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  feature_key VARCHAR(50) NOT NULL,
  is_enabled TINYINT(1) DEFAULT 1,
  UNIQUE KEY uq_vendor_feature (vendor_id, feature_key),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 3. settings  (per vendor)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT,
  description VARCHAR(255),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vendor_setting (vendor_id, setting_key),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 4. categories
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) DEFAULT '',
  sort_order INT DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 5. menu_items
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  category_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  is_available TINYINT(1) DEFAULT 1,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 6. item_addons
-- ============================================================
CREATE TABLE IF NOT EXISTS item_addons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) DEFAULT 0.00,
  is_active TINYINT(1) DEFAULT 1,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 7. sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  phone VARCHAR(20) NOT NULL,
  vendor_id INT NOT NULL,
  customer_name VARCHAR(100),
  customer_phone VARCHAR(20),
  state VARCHAR(30) DEFAULT 'WELCOME',
  cart JSON,
  pending_item_id INT,
  pending_coupon VARCHAR(30),
  pending_discount DECIMAL(10,2) DEFAULT 0,
  delivery_charge DECIMAL(10,2) DEFAULT 0,
  payment_method VARCHAR(10),
  pending_addons TEXT,
  temp_address TEXT,
  temp_lat DECIMAL(10,8),
  temp_lng DECIMAL(11,8),
  temp_dist DECIMAL(5,2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (phone, vendor_id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 8. orders
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  msg_vendor_id INT NULL,
  order_number VARCHAR(40) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  customer_name VARCHAR(100),
  customer_phone VARCHAR(20),
  items JSON NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) DEFAULT 0.00,
  delivery_charge DECIMAL(10,2) DEFAULT 0.00,
  gst_amount DECIMAL(10,2) DEFAULT 0.00,
  total DECIMAL(10,2) NOT NULL,
  payment_method ENUM('online','cod') NOT NULL,
  payment_status VARCHAR(20) DEFAULT 'pending',
  order_status ENUM('waiting','confirmed','preparing','ready','delivered','cancelled') DEFAULT 'waiting',
  delivery_address TEXT,
  customer_lat DECIMAL(10,8),
  customer_lng DECIMAL(11,8),
  distance_km DECIMAL(5,2),
  coupon_code VARCHAR(30),
  razorpay_order_id VARCHAR(100),
  payment_link TEXT,
  bill_token VARCHAR(64),
  bill_viewed_at TIMESTAMP NULL,
  delivery_boy_id INT NULL,
  delivery_assigned_at TIMESTAMP NULL,
  review_sent TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 9. delivery_boys
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_boys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  whatsapp_number VARCHAR(20) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 10. coupons
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  code VARCHAR(30) NOT NULL,
  type ENUM('flat','percent') NOT NULL,
  value DECIMAL(10,2) NOT NULL,
  min_order DECIMAL(10,2) DEFAULT 0.00,
  max_discount DECIMAL(10,2) DEFAULT 0.00,
  usage_limit INT DEFAULT 0,
  used_count INT DEFAULT 0,
  per_user_limit INT DEFAULT 1,
  is_active TINYINT(1) DEFAULT 1,
  expires_at DATE NULL,
  description VARCHAR(255),
  UNIQUE KEY uq_vendor_code (vendor_id, code),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 11. coupon_usage
-- ============================================================
CREATE TABLE IF NOT EXISTS coupon_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  coupon_id INT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  order_id INT,
  discount_amount DECIMAL(10,2),
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 12. status_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS status_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  status VARCHAR(30) NOT NULL,
  message TEXT,
  is_active TINYINT(1) DEFAULT 1,
  UNIQUE KEY uq_vendor_status (vendor_id, status),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 13. store_schedule
-- ============================================================
CREATE TABLE IF NOT EXISTS store_schedule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  day_of_week TINYINT NOT NULL COMMENT '0=Sunday, 6=Saturday',
  day_name VARCHAR(15) NOT NULL,
  is_open TINYINT(1) DEFAULT 1,
  open_time TIME DEFAULT '10:00:00',
  close_time TIME DEFAULT '22:00:00',
  UNIQUE KEY uq_vendor_day (vendor_id, day_of_week),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 14. message_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS message_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  direction ENUM('in','out') NOT NULL,
  message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- STORED PROCEDURE: setup_vendor_defaults
-- Call after creating a vendor: CALL setup_vendor_defaults(vendor_id)
-- ============================================================
DELIMITER $$

CREATE PROCEDURE IF NOT EXISTS setup_vendor_defaults(IN vid INT)
BEGIN
  -- Default settings
  INSERT IGNORE INTO settings (vendor_id, setting_key, setting_value, description) VALUES
    (vid, 'restaurant_name',      'My Restaurant',            'Restaurant name'),
    (vid, 'restaurant_phone',     '',                         'WhatsApp number for notifications (with country code)'),
    (vid, 'restaurant_address',   '',                         'Restaurant address'),
    (vid, 'restaurant_lat',       '',                         'Restaurant latitude'),
    (vid, 'restaurant_lng',       '',                         'Restaurant longitude'),
    (vid, 'service_radius_km',    '5',                        'Max delivery radius in km'),
    (vid, 'delivery_charge',      '50',                       'Flat delivery charge'),
    (vid, 'free_delivery_above',  '500',                      'Free delivery if order above this amount'),
    (vid, 'min_order_amount',     '100',                      'Minimum order amount'),
    (vid, 'cod_enabled',          '1',                        'Allow Cash on Delivery'),
    (vid, 'online_payment_enabled','1',                       'Allow online payment via Razorpay'),
    (vid, 'estimated_time',       '30-45',                    'Estimated delivery time (shown to customer)'),
    (vid, 'gst_enabled',          '0',                        'Enable GST calculation'),
    (vid, 'gst_percent',          '5',                        'GST percentage'),
    (vid, 'gst_included',         '0',                        '1 = GST included in price, 0 = GST added on top'),
    (vid, 'store_open',           '1',                        'Manual store open/close override'),
    (vid, 'store_closed_msg',     'Sorry, we are closed right now. Please visit us during business hours.', 'Message when store is closed'),
    (vid, 'store_timezone',       'Asia/Kolkata',             'Timezone for store schedule'),
    (vid, 'google_review_link',   '',                         'Google review URL'),
    (vid, 'whatsapp_token',       '',                         'Meta WhatsApp Cloud API token'),
    (vid, 'whatsapp_phone_id',    '',                         'WhatsApp Phone Number ID'),
    (vid, 'verify_token',         'foodbot123',               'Webhook verify token'),
    (vid, 'razorpay_key_id',      '',                         'Razorpay Key ID'),
    (vid, 'razorpay_key_secret',  '',                         'Razorpay Key Secret'),
    (vid, 'razorpay_webhook_secret','',                       'Razorpay webhook secret'),
    (vid, 'base_url',             'http://localhost:3000',    'Base URL for bill links'),
    (vid, 'restaurant_logo_url',  '',                         'Logo URL for bill'),
    (vid, 'restaurant_tagline',   '',                         'Tagline shown on bill'),
    (vid, 'restaurant_gstin',     '',                         'GSTIN number for bill'),
    (vid, 'bill_footer_text',     'Thank you for ordering!',  'Footer text on bill'),
    (vid, 'review_after_minutes', '60',                       'Send review request after N minutes of delivery'),
    (vid, 'store_discount_enabled', '0',                      'Enable store-wide automatic discount (1=Yes, 0=No)'),
    (vid, 'store_discount_type',  'percent',                  'Store-wide discount type (percent or flat)'),
    (vid, 'store_discount_value', '0',                        'Store-wide discount value'),
    (vid, 'happy_hour_enabled',   '0',                        'Enable happy hour automatic discount (1=Yes, 0=No)'),
    (vid, 'happy_hour_type',      'percent',                  'Happy hour discount type (percent or flat)'),
    (vid, 'happy_hour_value',     '0',                        'Happy hour discount value'),
    (vid, 'happy_hour_start',     '16:00',                    'Happy hour start time (HH:MM)'),
    (vid, 'happy_hour_end',       '19:00',                    'Happy hour end time (HH:MM)'),
    (vid, 'kitchen_passcode',     '1234',                     'Passcode for kitchen staff login (4-digits)');

  -- Default features (all enabled, broadcast OFF by default)
  INSERT IGNORE INTO vendor_features (vendor_id, feature_key, is_enabled) VALUES
    (vid, 'coupon_system',    1),
    (vid, 'online_payment',   1),
    (vid, 'delivery_boys',    1),
    (vid, 'gst',              1),
    (vid, 'bill_generation',  1),
    (vid, 'review_request',   1),
    (vid, 'store_schedule',   1),
    (vid, 'broadcast',        0);

  -- Default store schedule (Mon-Sat open, Sun closed)
  INSERT IGNORE INTO store_schedule (vendor_id, day_of_week, day_name, is_open, open_time, close_time) VALUES
    (vid, 0, 'Sunday',    0, '10:00:00', '22:00:00'),
    (vid, 1, 'Monday',    1, '10:00:00', '22:00:00'),
    (vid, 2, 'Tuesday',   1, '10:00:00', '22:00:00'),
    (vid, 3, 'Wednesday', 1, '10:00:00', '22:00:00'),
    (vid, 4, 'Thursday',  1, '10:00:00', '22:00:00'),
    (vid, 5, 'Friday',    1, '10:00:00', '22:00:00'),
    (vid, 6, 'Saturday',  1, '10:00:00', '22:00:00');

  -- Default status messages
  INSERT IGNORE INTO status_messages (vendor_id, status, message, is_active) VALUES
    (vid, 'confirmed',  'Hi {name}! ✅ Your order *#{order_number}* has been confirmed.\n\n{items}\n\n💰 Total: ₹{total}\n⏱️ Estimated time: {estimated_time} mins\n\nThank you for ordering!', 1),
    (vid, 'preparing',  'Hi {name}! 👨‍🍳 Your order *#{order_number}* is being prepared.\n\nWe''ll notify you when it''s ready!', 1),
    (vid, 'ready',      'Hi {name}! ✅ Your order *#{order_number}* is ready!\n\n{delivery_or_pickup}', 1),
    (vid, 'delivered',  'Hi {name}! 🎉 Your order *#{order_number}* has been delivered!\n\nWe hope you enjoyed your meal. Please share your feedback:\n{review_link}', 1),
    (vid, 'cancelled',  'Hi {name}, your order *#{order_number}* has been cancelled.\n\nIf you have any questions, please contact us.', 1);
END$$

DELIMITER ;

-- ============================================================
-- 15. plans  (global, managed by super admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  msg_count INT NOT NULL COMMENT 'Messages per billing period',
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

-- ============================================================
-- 16. vendor_subscriptions  (one row per vendor)
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  plan_id INT NULL,
  plan_name VARCHAR(100) DEFAULT 'Trial',
  billing_type ENUM('trial','monthly','yearly') DEFAULT 'trial',
  messages_total INT DEFAULT 50,
  messages_used INT DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NULL COMMENT 'NULL = no expiry (trial)',
  status ENUM('active','expired','suspended') DEFAULT 'active',
  alert_80_sent TINYINT(1) DEFAULT 0,
  alert_100_sent TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vendor_sub (vendor_id),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 17. subscription_payments  (payment history)
-- ============================================================
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

-- ============================================================
-- 18. conversation_windows  (track 24-hr Meta-style windows)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_windows (
  vendor_id INT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  window_opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vendor_id, phone),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 19. platform_settings  (super-admin / platform-level key-value config,
--     e.g. shared WhatsApp token, platform Razorpay keys for vendors on
--     payment_gateway_mode='platform')
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 20. vendor_wallet_transactions  (online payments received via the PLATFORM
--     Razorpay gateway, for vendors with payment_gateway_mode='platform')
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  order_id INT NOT NULL,
  order_number VARCHAR(40),
  amount DECIMAL(10,2) NOT NULL,
  settlement_status ENUM('pending','settled') NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_wallet_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
