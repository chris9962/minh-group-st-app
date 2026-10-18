-- Loại nhân viên khỏi điểm phòng theo tháng (chốt 2026-10-18). Người bị loại
-- không vào Điểm TB phòng, số nhân sự đạt chỉ tiêu, tổng điểm phòng và tổng
-- điểm nhánh. Điểm và lương của chính họ không đổi.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm, cùng lối 0134. Phần cấp
-- `*:exclude-department-points` cho tài khoản toàn quyền nằm ở script
-- `db:grant-exclude-department-points`, chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'exclude-department-points';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "department_point_exclusions" (
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"year_month" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_point_exclusions_user_id_year_month_pk" PRIMARY KEY("user_id","year_month")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "department_point_exclusions_month" ON "department_point_exclusions" USING btree ("year_month");
