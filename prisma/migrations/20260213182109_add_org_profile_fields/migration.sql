-- AlterTable
ALTER TABLE `invoices` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `licenses` MODIFY `suspendedReason` VARCHAR(191) NULL,
    ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `contact` VARCHAR(191) NULL,
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `trn` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `users` MODIFY `role` ENUM('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER') NOT NULL DEFAULT 'USER';
