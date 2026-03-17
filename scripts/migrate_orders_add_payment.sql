-- Run this migration against your MySQL database to support
-- storing payment_method and delivery_address on orders.

ALTER TABLE orders
  ADD COLUMN payment_method    VARCHAR(50) DEFAULT 'upi'  AFTER grand_total,
  ADD COLUMN delivery_address  TEXT                        AFTER payment_method;
