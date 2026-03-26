-- Add Firebase Cloud Messaging fields to users
ALTER TABLE users ADD COLUMN fcm_token TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN notifications_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notification_token_updated_at TIMESTAMP NULL DEFAULT NULL;
