-- Ẩn Mã text với nhân viên (chốt 2026-10-03). Mã loại này chỉ để kiểm ảnh: ô
-- chọn mã, bước 2 và danh sách tài khoản trả Mã text rỗng. Kho mã P-61 và trang
-- quản lý ngân hàng vẫn đọc đủ.
ALTER TABLE "referral_codes" ADD COLUMN IF NOT EXISTS "hide_code" boolean NOT NULL DEFAULT false;
