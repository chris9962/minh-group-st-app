-- Cách chấm công theo phòng (chốt 2026-10-13). Thay hai điều kiện viết cứng
-- `salary_scheme = 'atm'` và mã phòng `PHONG-AN-SINH`. Để trống là phòng không
-- chấm công. Admin bật cho từng phòng ở P-91 sau khi deploy.
CREATE TYPE "attendance_mode" AS ENUM ('slots', 'daily');
--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "attendance_mode" "attendance_mode";
