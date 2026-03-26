-- Create users table for grocery store
CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) DEFAULT 'User',
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(15) DEFAULT NULL,
  address TEXT DEFAULT NULL,
  fcm_token TEXT DEFAULT NULL,
  notifications_enabled TINYINT(1) NOT NULL DEFAULT 0,
  notification_token_updated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
