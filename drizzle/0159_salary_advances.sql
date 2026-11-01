-- Yêu cầu tạm ứng lương (chủ dự án chốt 2026-11-01): nhân viên gửi ngày 10,
-- Trưởng phòng duyệt trong ngày 10, kế toán duyệt và chi từ ngày 11.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm, cùng lối 0154 và 0155. Phần cấp
-- quyền cho tài khoản có sẵn nằm ở script `db:grant-approve-advance`, chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'approve-advance';--> statement-breakpoint
CREATE TYPE "salary_advance_status" AS ENUM (
	'pending', 'head-approved', 'head-rejected', 'expired', 'approved', 'rejected', 'processing', 'paid'
);--> statement-breakpoint
CREATE TYPE "salary_advance_event_kind" AS ENUM (
	'create', 'edit', 'head-approve', 'head-reject', 'expire', 'approve', 'reject', 'processing', 'paid'
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_advance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"year_month" text NOT NULL,
	"department_id" uuid REFERENCES "departments"("id"),
	"amount" integer NOT NULL,
	"status" "salary_advance_status" DEFAULT 'pending' NOT NULL,
	"reject_reason" text DEFAULT '' NOT NULL,
	"adjustment_id" uuid REFERENCES "salary_adjustments"("id") ON DELETE RESTRICT,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_advance_requests_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salary_advance_requests_user_month" ON "salary_advance_requests" ("user_id", "year_month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_advance_requests_month_status" ON "salary_advance_requests" ("year_month", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_advance_requests_month_department" ON "salary_advance_requests" ("year_month", "department_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_advance_requests_adjustment" ON "salary_advance_requests" ("adjustment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_advance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL REFERENCES "salary_advance_requests"("id") ON DELETE CASCADE,
	"kind" "salary_advance_event_kind" NOT NULL,
	"actor_id" uuid REFERENCES "users"("id"),
	"from_amount" integer,
	"to_amount" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_advance_events_request" ON "salary_advance_events" ("request_id", "created_at");
