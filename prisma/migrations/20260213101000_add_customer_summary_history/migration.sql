-- CreateTable
CREATE TABLE `customer_summary_history` (
    `id` VARCHAR(191) NOT NULL,
    `summaryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `mobile` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `importantKey` TEXT NULL,
    `editedBy` VARCHAR(191) NOT NULL,
    `editedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_summary_history_summaryId_idx`(`summaryId`),
    INDEX `customer_summary_history_editedBy_idx`(`editedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customer_summary_history` ADD CONSTRAINT `customer_summary_history_summaryId_fkey` FOREIGN KEY (`summaryId`) REFERENCES `customer_summaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_summary_history` ADD CONSTRAINT `customer_summary_history_editedBy_fkey` FOREIGN KEY (`editedBy`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
