-- Ảnh CCCD có thể có hai mặt. Ảnh thứ nhất vẫn nằm ở cột cũ để mọi đơn lịch sử
-- đọc nguyên vẹn; ảnh thứ hai tùy chọn nên đơn chỉ có một ảnh không phải đổi.
ALTER TABLE "insurance_orders"
  ADD COLUMN IF NOT EXISTS "intake_photo_back_url" text;
