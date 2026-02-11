-- Safe additive migration for licensing + billing.
-- This migration only creates new tables/indexes and does not drop existing objects.

CREATE TABLE IF NOT EXISTS `licenses` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `licenseKey` VARCHAR(191) NOT NULL,
  `plan` ENUM('TRIAL', 'BASIC', 'PRO', 'ENTERPRISE') NOT NULL DEFAULT 'TRIAL',
  `status` ENUM('ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELED') NOT NULL DEFAULT 'ACTIVE',
  `seats` INT NOT NULL DEFAULT 1,
  `usedSeats` INT NOT NULL DEFAULT 1,
  `messageQuota` INT NOT NULL DEFAULT 1000,
  `messageUsed` INT NOT NULL DEFAULT 0,
  `periodStart` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  `activatedAt` DATETIME(3) NULL,
  `suspendedReason` TEXT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `licenses_licenseKey_key`(`licenseKey`),
  INDEX `licenses_organizationId_status_idx`(`organizationId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `licenseId` VARCHAR(191) NULL,
  `provider` VARCHAR(191) NOT NULL,
  `providerRef` VARCHAR(191) NULL,
  `amountCents` INT NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'THB',
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `paidAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `invoices_organizationId_status_idx`(`organizationId`, `status`),
  INDEX `invoices_providerRef_idx`(`providerRef`),
  INDEX `invoices_licenseId_idx`(`licenseId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add FK constraints only if they don't already exist.
SET @fk1_exists := (
  SELECT COUNT(1)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'licenses'
    AND CONSTRAINT_NAME = 'licenses_organizationId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_fk1 := IF(
  @fk1_exists = 0,
  'ALTER TABLE `licenses` ADD CONSTRAINT `licenses_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_fk1 FROM @sql_fk1;
EXECUTE stmt_fk1;
DEALLOCATE PREPARE stmt_fk1;

SET @fk2_exists := (
  SELECT COUNT(1)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoices'
    AND CONSTRAINT_NAME = 'invoices_organizationId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_fk2 := IF(
  @fk2_exists = 0,
  'ALTER TABLE `invoices` ADD CONSTRAINT `invoices_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_fk2 FROM @sql_fk2;
EXECUTE stmt_fk2;
DEALLOCATE PREPARE stmt_fk2;

SET @fk3_exists := (
  SELECT COUNT(1)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoices'
    AND CONSTRAINT_NAME = 'invoices_licenseId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_fk3 := IF(
  @fk3_exists = 0,
  'ALTER TABLE `invoices` ADD CONSTRAINT `invoices_licenseId_fkey` FOREIGN KEY (`licenseId`) REFERENCES `licenses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_fk3 FROM @sql_fk3;
EXECUTE stmt_fk3;
DEALLOCATE PREPARE stmt_fk3;

