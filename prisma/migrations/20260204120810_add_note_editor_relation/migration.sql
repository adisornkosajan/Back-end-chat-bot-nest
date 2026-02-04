-- CreateIndex
CREATE INDEX `note_history_editedBy_idx` ON `note_history`(`editedBy`);

-- AddForeignKey
ALTER TABLE `note_history` ADD CONSTRAINT `note_history_editedBy_fkey` FOREIGN KEY (`editedBy`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
