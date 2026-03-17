-- Run this migration against your MySQL database to support
-- storing detailed payment info (like UPI IDs) on orders.

ALTER TABLE orders
  ADD COLUMN payment_details VARCHAR(255) AFTER payment_method;
