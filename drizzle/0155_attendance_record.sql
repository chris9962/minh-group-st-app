-- Ghi công thay nhân viên ở màn Chấm công (chốt 2026-10-30).
-- Lượt ghi công nằm chung bảng `attendance_checks`, nên ngày công và file Ngày công tính như lượt tự chấm.
-- Lượt ghi công không có ảnh và vị trí; `recorded_by`, `recorded_at` là người ghi và lúc ghi.
-- `checked_out_at` là giờ ra của lượt điểm danh do người ghi nhập.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm, cùng lối 0134 và 0143. Phần cấp
-- `*:record-attendance` cho tài khoản toàn quyền nằm ở script `db:grant-record-attendance`.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'record-attendance';--> statement-breakpoint
ALTER TABLE "attendance_checks" ALTER COLUMN "latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_checks" ALTER COLUMN "longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_checks" ALTER COLUMN "accuracy" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_checks" ADD COLUMN IF NOT EXISTS "recorded_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "attendance_checks" ADD COLUMN IF NOT EXISTS "recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_checks" ADD COLUMN IF NOT EXISTS "checked_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_checks" ADD CONSTRAINT "attendance_checks_location" CHECK (
	"recorded_by" IS NOT NULL OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "accuracy" IS NOT NULL)
);
