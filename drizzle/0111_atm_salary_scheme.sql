-- Lương nhân viên trực điểm ATM theo thông báo 2026-09-30, áp từ 2026-10-01
-- (chốt với chủ dự án 2026-09-30).
--
-- 1. `users.salary_scheme`: ai mang `atm` thì tính lương theo công thức điểm ATM
--    và là nhóm DUY NHẤT có điểm dịch vụ.
-- 2. `service_types`: thêm trần số lượt được tính điểm theo ngày và theo tháng.
--
-- Chỉ có CẤU TRÚC. Ai thuộc nhóm `atm`, điểm mỗi lượt và trần của từng loại
-- dịch vụ là dữ liệu của công ty, đổi theo thời gian: ghi bằng
-- `bun run db:seed-atm-2026-10`, không ghi ở đây.
DO $$ BEGIN
  CREATE TYPE "salary_scheme" AS ENUM ('department', 'atm');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "salary_scheme" "salary_scheme" DEFAULT 'department' NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_types" ADD COLUMN IF NOT EXISTS "daily_cap" integer;
--> statement-breakpoint
ALTER TABLE "service_types" ADD COLUMN IF NOT EXISTS "monthly_cap" integer;
--> statement-breakpoint
ALTER TABLE "service_types" DROP CONSTRAINT IF EXISTS "service_types_caps_positive";
--> statement-breakpoint
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_caps_positive" CHECK (coalesce("daily_cap", 1) > 0 and coalesce("monthly_cap", 1) > 0);
