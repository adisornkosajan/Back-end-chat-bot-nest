/*
  Warnings:

  - You are about to alter the column `status` on the `broadcast_recipients` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(6))`.
  - You are about to alter the column `status` on the `broadcasts` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(5))`.

*/
-- AlterTable
ALTER TABLE `broadcast_recipients` MODIFY `status` ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `broadcasts` MODIFY `status` ENUM('draft', 'scheduled', 'paused', 'sending', 'sent', 'failed') NOT NULL DEFAULT 'draft';
