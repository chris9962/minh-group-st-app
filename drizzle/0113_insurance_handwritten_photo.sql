-- Ảnh giấy viết tay của nhân viên cho đơn bảo hiểm đã hoàn thành (chốt
-- 2026-10-01). Chỉ người tạo đơn tải lên. Cột giữ KHOÁ trong kho ảnh, cùng luật
-- `certificate_photo_url`.
ALTER TABLE "insurance_orders" ADD COLUMN IF NOT EXISTS "handwritten_photo_url" text;
