-- Ứng lương, thưởng và trừ lương theo tháng (chốt 2026-10-31). Ghi ở tab Lương
-- của màn Nhân sự & KPI, quyền `system:close-salary`; tháng đã chốt lương thì khoá.
CREATE TYPE "salary_adjustment_kind" AS ENUM ('advance', 'bonus', 'deduction');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"year_month" text NOT NULL,
	"kind" "salary_adjustment_kind" NOT NULL,
	"amount" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_adjustments_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salary_adjustments_month_user" ON "salary_adjustments" ("year_month", "user_id");
