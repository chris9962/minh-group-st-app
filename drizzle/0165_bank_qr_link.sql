-- Link của ngân hàng, hiện thành mã QR ở bước 2 của màn mở tài khoản (ShopeePay, chốt 2026-11-10).
ALTER TABLE "banks" ADD COLUMN IF NOT EXISTS "qr_link" text;
