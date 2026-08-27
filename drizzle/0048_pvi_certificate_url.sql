-- Link file PDF giấy chứng nhận PVI trả về ở callback mục 13 (chốt 2026-08-27).
--
-- Cột RIÊNG, không dùng chung `certificate_photo_url`: cột đó là KHOÁ ảnh trong
-- kho S3 do bot Playwright chụp lại, đọc qua `GET /api/images/<key>`. Cột này là
-- URL tuyệt đối trỏ thẳng sang máy chủ PVI, mở bằng cách bấm vào link.
--
-- Rỗng = chưa nhận được callback, hoặc đơn tạo bằng bot chứ không qua API.
ALTER TABLE "insurance_orders"
  ADD COLUMN "pvi_certificate_url" text NOT NULL DEFAULT '';
