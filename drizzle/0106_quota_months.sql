-- Chỉ tiêu theo QĐ 145, áp dụng từ 2026-09-01 (chốt với chủ dự án 2026-09-25).
--
-- `users.contract_type` để null: loại hợp đồng nhập sau bằng
-- `bun run db:import-contract-types` hoặc ở hộp thoại sửa nhân viên. Người null
-- không có chỉ tiêu cá nhân.
--
-- Migration KHÔNG chèn chỉ tiêu tháng nào: admin nhập trên màn Chỉ tiêu tháng.
-- Thiếu dòng thì lương tháng đó không chấm chỉ tiêu, giống trước migration.
DO $$ BEGIN
	CREATE TYPE "public"."contract_type" AS ENUM('hdld', 'hddv', 'hdtv');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."quota_account_kind" AS ENUM('hkd', 'directed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "contract_type" "contract_type";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quota_months" (
	"year_month" text PRIMARY KEY NOT NULL,
	"staff_hkd" integer,
	"staff_directed" integer,
	"staff_casa" integer,
	"updated_by" uuid REFERENCES "users"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_months_positive" CHECK (coalesce("staff_hkd", 1) > 0 and coalesce("staff_directed", 1) > 0 and coalesce("staff_casa", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "department_quotas" (
	"year_month" text NOT NULL REFERENCES "quota_months"("year_month") ON DELETE cascade,
	"department_id" uuid NOT NULL REFERENCES "departments"("id") ON DELETE cascade,
	"hkd" integer,
	"directed" integer,
	"casa" integer,
	CONSTRAINT "department_quotas_year_month_department_id_pk" PRIMARY KEY("year_month","department_id"),
	CONSTRAINT "department_quotas_positive" CHECK (coalesce("hkd", 1) > 0 and coalesce("directed", 1) > 0 and coalesce("casa", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quota_account_kinds" (
	"year_month" text NOT NULL REFERENCES "quota_months"("year_month") ON DELETE cascade,
	"kind" "quota_account_kind" NOT NULL,
	"bank_id" uuid NOT NULL REFERENCES "banks"("id") ON DELETE cascade,
	"account_type" "bank_account_type" NOT NULL,
	CONSTRAINT "quota_account_kinds_year_month_kind_bank_id_account_type_pk" PRIMARY KEY("year_month","kind","bank_id","account_type")
);
