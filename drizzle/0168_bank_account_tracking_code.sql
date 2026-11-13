-- Mã đơn hàng của đơn quà ShopeePay, nhân viên dán ở bước 2 thay cho số tài khoản liên kết (chốt 2026-11-13).
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "tracking_code" text;
