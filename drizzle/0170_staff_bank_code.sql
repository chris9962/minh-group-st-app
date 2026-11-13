-- Mã ngân hàng nhận lương (mã Citad, ví dụ 01358001 của TPBank) cho file chuyển lương. Không bắt buộc.
ALTER TABLE "staff_profiles" ADD COLUMN IF NOT EXISTS "bank_code" text;
