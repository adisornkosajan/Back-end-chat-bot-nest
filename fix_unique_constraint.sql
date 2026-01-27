-- ลบ unique constraint เก่า (ถ้ามี)
ALTER TABLE `platforms` DROP INDEX IF EXISTS `platforms_organizationId_type_key`;

-- ตรวจสอบว่ามี unique constraint ใหม่หรือยัง
-- ถ้ายังไม่มี ให้เพิ่ม
-- ALTER TABLE `platforms` ADD UNIQUE INDEX `platforms_organizationId_type_pageId_key` (`organizationId`, `type`, `pageId`);
