-- AlterTable
ALTER TABLE `conversations` ADD COLUMN `assignedAgentId` VARCHAR(191) NULL,
    ADD COLUMN `firstResponseAt` DATETIME(3) NULL,
    ADD COLUMN `lastResponseAt` DATETIME(3) NULL;
