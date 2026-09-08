-- Ảnh hồ sơ của đơn bảo hiểm (chốt 2026-09-07): KD chụp một tấm lúc lập đơn,
-- gói 2 đơn thì 2 tấm. Khác `certificate_photo_url` là tờ chứng nhận PVI phát
-- về sau. Null với đơn lập trước migration này; biểu mẫu tạo đơn bắt buộc có.
ALTER TABLE "insurance_orders"
  ADD COLUMN IF NOT EXISTS "intake_photo_url" text;
