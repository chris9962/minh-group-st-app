-- Đánh lỗi kèm "Không cho sửa" (chốt 2026-10-12): nhân viên không sửa được tài
-- khoản lỗi này, chỉ người quản ngân hàng khôi phục được.
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "error_locked" boolean DEFAULT false NOT NULL;
