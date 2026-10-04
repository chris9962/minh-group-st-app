-- Điểm danh Phòng An Sinh và ngày công từ chấm công (spec
-- docs/spec-bhyt-bhxh-an-sinh.md mục 4, chốt 2026-10-04).
--
-- Lượt `check-in` là điểm danh 1 nút của Phòng An Sinh: tọa độ GPS và giờ máy
-- chủ, không có ảnh. ADD VALUE chạy được trong transaction vì file này không
-- dùng giá trị mới.
ALTER TYPE "attendance_slot" ADD VALUE IF NOT EXISTS 'check-in';--> statement-breakpoint
ALTER TABLE "attendance_checks" ALTER COLUMN "photo_url" DROP NOT NULL;--> statement-breakpoint
-- Từ tháng 2026-10, nhân viên Điểm ATM được 0,5 ngày cho mỗi cặp vào ra. Lương
-- cộng cột này thay cho đếm số dòng.
ALTER TABLE "employee_work_days" ADD COLUMN IF NOT EXISTS "fraction" numeric(2, 1) NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "employee_work_days" DROP CONSTRAINT IF EXISTS "employee_work_days_fraction";--> statement-breakpoint
ALTER TABLE "employee_work_days" ADD CONSTRAINT "employee_work_days_fraction" CHECK ("fraction" IN (0.5, 1));--> statement-breakpoint
-- Ngày công từ chấm công không gắn khách nào, nên ghi 0 khách.
ALTER TABLE "employee_work_days" DROP CONSTRAINT IF EXISTS "employee_work_days_customer_count_positive";--> statement-breakpoint
ALTER TABLE "employee_work_days" DROP CONSTRAINT IF EXISTS "employee_work_days_customer_count_non_negative";--> statement-breakpoint
ALTER TABLE "employee_work_days" ADD CONSTRAINT "employee_work_days_customer_count_non_negative" CHECK ("qualifying_customer_count" >= 0);
