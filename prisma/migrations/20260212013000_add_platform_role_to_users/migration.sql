-- Add platform-level role for SaaS owner/support (separate from org role)
ALTER TABLE `users`
  ADD COLUMN `platformRole` ENUM('NONE', 'OWNER', 'SUPPORT_ADMIN') NOT NULL DEFAULT 'NONE';

