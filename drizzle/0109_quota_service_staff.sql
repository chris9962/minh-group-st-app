-- Chỉ tiêu mỗi nhân viên HĐDV, có từ tháng 2026-10 (chốt với chủ dự án 2026-09-29).
--
-- Ba cột chỉ lưu: lương HĐDV không cộng trừ theo chỉ tiêu. Ô null = không giao,
-- nên tháng 2026-09 trở về trước giữ nguyên.
ALTER TABLE "quota_months" ADD COLUMN IF NOT EXISTS "service_hkd" integer;
--> statement-breakpoint
ALTER TABLE "quota_months" ADD COLUMN IF NOT EXISTS "service_directed" integer;
--> statement-breakpoint
ALTER TABLE "quota_months" ADD COLUMN IF NOT EXISTS "service_casa" integer;
--> statement-breakpoint
ALTER TABLE "quota_months" DROP CONSTRAINT IF EXISTS "quota_months_positive";
--> statement-breakpoint
ALTER TABLE "quota_months" ADD CONSTRAINT "quota_months_positive" CHECK (coalesce("staff_hkd", 1) > 0 and coalesce("staff_directed", 1) > 0 and coalesce("staff_casa", 1) > 0 and coalesce("service_hkd", 1) > 0 and coalesce("service_directed", 1) > 0 and coalesce("service_casa", 1) > 0);
