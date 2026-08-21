-- Ảnh chuyển sang bucket PRIVATE của FPT: cột lưu KHOÁ, không lưu URL nữa.
--
-- Bản trước lưu nguyên đường dẫn `/uploads/<key>` của bản tạm ghi xuống đĩa. Từ
-- đây `server/storage.ts` dựng URL lúc đọc (`/api/images/<key>`), nên phần lưu
-- lại phải là khoá trần — bằng không mọi ảnh cũ trỏ vào `/api/images//uploads/...`
-- và không tấm nào tải được.
--
-- `/uploads/` dài 9 ký tự nên cắt từ ký tự thứ 10.
UPDATE "bank_account_photos"
SET "url" = substring("url" FROM 10)
WHERE "url" LIKE '/uploads/%';

UPDATE "insurance_orders"
SET "certificate_photo_url" = substring("certificate_photo_url" FROM 10)
WHERE "certificate_photo_url" LIKE '/uploads/%';
