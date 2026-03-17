-- Add address column to users table for persisting delivery address
ALTER TABLE users ADD COLUMN address TEXT DEFAULT NULL;
