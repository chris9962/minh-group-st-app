-- Tài khoản ngân hàng khách liên kết với ví ShopeePay, nhân viên gõ tay ở bước 2 (chốt 2026-11-10).
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "linked_bank_name" text;
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "linked_account_number" text;
