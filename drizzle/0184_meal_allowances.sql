-- Lương ăn ca (chủ dự án chốt 2026-11-20, thiết kế ở `docs/thiet-ke-luong-an-ca-2026-11-20.md`):
-- app lập danh sách tháng M, Trưởng phòng sửa số ngày và duyệt ngày cuối tháng M,
-- kế toán duyệt và chi từ ngày 1 tháng M+1.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm, cùng lối 0159. Phần cấp quyền
-- cho tài khoản có sẵn nằm ở script `db:grant-meal-allowance`, chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'approve-meal';--> statement-breakpoint
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'pay-meal';--> statement-breakpoint
ALTER TYPE "salary_adjustment_kind" ADD VALUE IF NOT EXISTS 'meal';--> statement-breakpoint
CREATE TYPE "meal_allowance_status" AS ENUM (
	'pending', 'head-approved', 'forwarded', 'approved', 'rejected', 'processing', 'paid'
);--> statement-breakpoint
CREATE TYPE "meal_allowance_event_kind" AS ENUM (
	'create', 'edit', 'head-approve', 'forward', 'approve', 'reject', 'processing', 'paid'
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meal_allowance_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"year_month" text NOT NULL,
	"department_id" uuid REFERENCES "departments"("id"),
	"edited_days" numeric(3, 1),
	"locked_days" numeric(3, 1),
	"status" "meal_allowance_status" DEFAULT 'pending' NOT NULL,
	"reject_reason" text DEFAULT '' NOT NULL,
	"adjustment_id" uuid REFERENCES "salary_adjustments"("id") ON DELETE RESTRICT,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_allowance_rows_edited_days" CHECK ("edited_days" >= 0 AND "edited_days" * 2 = round("edited_days" * 2)),
	CONSTRAINT "meal_allowance_rows_locked_days" CHECK ("locked_days" >= 0 AND "locked_days" * 2 = round("locked_days" * 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meal_allowance_rows_user_month" ON "meal_allowance_rows" ("user_id", "year_month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_allowance_rows_month_status" ON "meal_allowance_rows" ("year_month", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_allowance_rows_month_department" ON "meal_allowance_rows" ("year_month", "department_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_allowance_rows_adjustment" ON "meal_allowance_rows" ("adjustment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meal_allowance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"row_id" uuid NOT NULL REFERENCES "meal_allowance_rows"("id") ON DELETE CASCADE,
	"kind" "meal_allowance_event_kind" NOT NULL,
	"actor_id" uuid REFERENCES "users"("id"),
	"from_days" numeric(3, 1),
	"to_days" numeric(3, 1),
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_allowance_events_row" ON "meal_allowance_events" ("row_id", "created_at");
