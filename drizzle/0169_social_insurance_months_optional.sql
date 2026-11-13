-- Luật hoa hồng BHYT/BHXH mới (chốt 2026-11-13) không chia theo số tháng, nên cột SỐ THÁNG của file không bắt buộc.
-- Check `months > 0` giữ nguyên: Postgres cho NULL đi qua check.
ALTER TABLE "social_insurance_records" ALTER COLUMN "months" DROP NOT NULL;
-- Chữ ở cột NHẬP LIỆU khi không tra ra nhân viên Điểm ATM, ví dụ tên người nhập.
ALTER TABLE "social_insurance_records" ADD COLUMN IF NOT EXISTS "entry_staff_text" text;
