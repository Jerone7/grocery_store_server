-- Comprehensive idempotent migration.
-- Run this ONCE against your MySQL database (grocery_store).
-- Safe to re-run: uses IF NOT EXISTS checks.

-- 1. Ensure payment_method column exists
SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'orders'
      AND COLUMN_NAME  = 'payment_method'
);
SET @sql = IF(@col_exists = 0,
    "ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50) NOT NULL DEFAULT 'upi' AFTER grand_total",
    'SELECT "payment_method already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Ensure delivery_address column exists
SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'orders'
      AND COLUMN_NAME  = 'delivery_address'
);
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE orders ADD COLUMN delivery_address TEXT AFTER payment_method',
    'SELECT "delivery_address already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Ensure payment_details column exists
SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'orders'
      AND COLUMN_NAME  = 'payment_details'
);
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE orders ADD COLUMN payment_details VARCHAR(255) DEFAULT NULL AFTER delivery_address',
    'SELECT "payment_details already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Update default status to 'pending' in orders table
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';

-- 5. Ensure amount column exists in order_items table
SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'order_items'
      AND COLUMN_NAME  = 'amount'
);
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE order_items ADD COLUMN amount DECIMAL(10, 2) AFTER price',
    'SELECT "amount already exists in order_items"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Final schema check
DESCRIBE orders;
DESCRIBE order_items;
