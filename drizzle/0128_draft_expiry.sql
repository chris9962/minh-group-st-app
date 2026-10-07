-- Bản nháp tài khoản ngân hàng sống 30 phút kể từ lúc giữ chỗ (chốt 2026-10-06).
-- Cột ghi lúc đã báo "sắp bị xoá" cho chủ bản nháp, NULL = chưa báo.
ALTER TABLE bank_accounts ADD COLUMN expiry_warned_at timestamptz;
--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'bank-expiring';
--> statement-breakpoint
