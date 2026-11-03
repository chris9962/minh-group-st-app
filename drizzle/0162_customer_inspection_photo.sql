-- Ảnh kèm dấu "đã kiểm tra" của Phòng Thanh tra (chủ dự án chốt 2026-11-03):
-- một tấm mỗi hồ sơ, lưu KHOÁ trong kho ảnh như `id_card_image`, rỗng = không có.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "inspected_photo" text NOT NULL DEFAULT '';
