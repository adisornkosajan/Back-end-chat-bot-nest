/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,type,pageId]` on the table `platforms` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `accessToken` to the `platforms` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pageId` to the `platforms` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable messages first
ALTER TABLE `messages` MODIFY `content` TEXT NOT NULL;

-- AlterTable platforms - add columns with defaults
ALTER TABLE `platforms` 
  ADD COLUMN `accessToken` TEXT,
  ADD COLUMN `pageId` VARCHAR(191) DEFAULT '';

-- Update existing data with values from credentials
UPDATE `platforms` SET 
  `pageId` = COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(`credentials`, '$.pageId')),
    JSON_UNQUOTE(JSON_EXTRACT(`credentials`, '$.instagramAccountId')),
    JSON_UNQUOTE(JSON_EXTRACT(`credentials`, '$.phoneNumberId')),
    CONCAT('legacy-', `id`)
  ),
  `accessToken` = COALESCE(`accessToken`, '')
WHERE `pageId` = '' OR `pageId` IS NULL OR `accessToken` IS NULL OR `accessToken` = '';

-- Make columns NOT NULL after update
ALTER TABLE `platforms`
  MODIFY `pageId` VARCHAR(191) NOT NULL,
  MODIFY `accessToken` TEXT NOT NULL,
  MODIFY `credentials` JSON NULL;

-- CreateIndex (ทำหลังสุด - DROP จะเกิดใน migration ถัดไป)
CREATE UNIQUE INDEX `platforms_organizationId_type_pageId_key` ON `platforms`(`organizationId`, `type`, `pageId`);


