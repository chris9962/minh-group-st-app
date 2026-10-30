-- Phân phôi bảo hiểm theo tháng và mục tiêu tỉ lệ đơn điện/xe (chốt 2026-10-29),
-- thiết kế ở docs/spec-phan-phoi-bao-hiem-2026-10-29.md.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm, cùng lối 0134 và 0143. Phần cấp
-- quyền cho tài khoản có sẵn nằm ở script `db:grant-insurance-blanks`, chạy SAU migrate.
-- 3 dòng danh mục phôi và mục tiêu 7/3 nạp bằng `db:seed-insurance-blanks`.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'allocate-blanks';--> statement-breakpoint
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'split-blanks';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_blank_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"product" "insurance_product" NOT NULL,
	"sum_insured" integer,
	"sort" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_blank_department_quotas" (
	"year_month" text NOT NULL,
	"department_id" uuid NOT NULL REFERENCES "departments"("id"),
	"blank_type_id" uuid NOT NULL REFERENCES "insurance_blank_types"("id"),
	"quantity" integer NOT NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_blank_department_quotas_pk" PRIMARY KEY ("year_month", "department_id", "blank_type_id"),
	CONSTRAINT "insurance_blank_department_quotas_quantity" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_blank_staff_quotas" (
	"year_month" text NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"blank_type_id" uuid NOT NULL REFERENCES "insurance_blank_types"("id"),
	"department_id" uuid NOT NULL REFERENCES "departments"("id"),
	"issued" integer NOT NULL,
	"used" integer,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_blank_staff_quotas_pk" PRIMARY KEY ("year_month", "user_id", "blank_type_id"),
	CONSTRAINT "insurance_blank_staff_quotas_issued" CHECK ("issued" >= 0),
	CONSTRAINT "insurance_blank_staff_quotas_used" CHECK ("used" IS NULL OR "used" >= 0),
	CONSTRAINT "insurance_blank_staff_quotas_not_empty" CHECK ("issued" > 0 OR "used" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insurance_blank_staff_quotas_department" ON "insurance_blank_staff_quotas" ("department_id", "year_month");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_mix_targets" (
	"year_month" text PRIMARY KEY NOT NULL,
	"electric_parts" smallint NOT NULL,
	"motorbike_parts" smallint NOT NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_mix_targets_parts" CHECK ("electric_parts" >= 0 AND "motorbike_parts" >= 0 AND "electric_parts" + "motorbike_parts" > 0)
);
