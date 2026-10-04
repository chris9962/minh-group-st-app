-- Trang BHYT/BHXH của Phòng An Sinh (spec docs/spec-bhyt-bhxh-an-sinh.md, chốt
-- 2026-10-04). Mỗi dòng file 1 là một dòng `social_insurance_records`, gắn với
-- một lượt dịch vụ "Nhập liệu BHYT/BHXH" của nhân viên ATM ở cột NHẬP LIỆU.
--
-- Tiền lưu `numeric(14,2)`. % lưu số nguyên theo đơn vị 0,001% (9,120% = 9120)
-- để phép nhân tiền × % không đi qua số thực.
--
-- Quyền: module `social-insurance`. Script `db:grant-social-insurance` cấp cho
-- Phòng An Sinh. Bộ % tháng 2026-10 nằm ở script `db:seed-social-insurance`.
--
-- ADD VALUE chạy được trong transaction vì file này không dùng giá trị mới.
ALTER TYPE "module_key" ADD VALUE IF NOT EXISTS 'social-insurance' BEFORE 'system';--> statement-breakpoint
CREATE TYPE "social_insurance_kind" AS ENUM ('bhyt', 'bhxh');--> statement-breakpoint
CREATE TYPE "social_insurance_plan" AS ENUM ('new', 'renewal');--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "social_insurance_code" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_social_insurance_code" ON "customers" ("social_insurance_code") WHERE "social_insurance_code" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collaborators" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_insurance_rates" (
  "year_month" text NOT NULL,
  "kind" "social_insurance_kind" NOT NULL,
  "plan" "social_insurance_plan" NOT NULL,
  "months" integer NOT NULL,
  "receive_rate" integer NOT NULL,
  "pay_rate" integer NOT NULL,
  "updated_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("year_month", "kind", "plan", "months"),
  CONSTRAINT "social_insurance_rates_year_month" CHECK ("year_month" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "social_insurance_rates_months" CHECK ("months" >= 0),
  CONSTRAINT "social_insurance_rates_renewal_any_month" CHECK ("plan" = 'new' OR "months" = 0),
  CONSTRAINT "social_insurance_rates_range" CHECK ("receive_rate" BETWEEN 0 AND 100000 AND "pay_rate" BETWEEN 0 AND 100000)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_insurance_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" "social_insurance_kind" NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "receipt_month" text NOT NULL,
  "plan" "social_insurance_plan" NOT NULL,
  "months" integer NOT NULL,
  "collected_amount" numeric(14, 2) NOT NULL,
  "paid_amount" numeric(14, 2) NOT NULL,
  "collaborator_id" uuid REFERENCES "collaborators"("id"),
  "service_id" uuid NOT NULL UNIQUE REFERENCES "services"("id"),
  "entry_staff_id" uuid NOT NULL REFERENCES "users"("id"),
  "uploaded_by" uuid NOT NULL REFERENCES "users"("id"),
  "uploaded_by_department_id" uuid REFERENCES "departments"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone,
  "reconciled_plan" "social_insurance_plan",
  "reconciled_months" integer,
  "reconciled_collected_amount" numeric(14, 2),
  "received_amount" numeric(14, 2),
  "received_rate" integer,
  "reconciled_at" timestamp with time zone,
  "reconciled_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "social_insurance_records_receipt_month" CHECK ("receipt_month" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "social_insurance_records_months" CHECK ("months" > 0),
  CONSTRAINT "social_insurance_records_collected" CHECK ("collected_amount" > 0),
  CONSTRAINT "social_insurance_records_paid" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "collected_amount")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_insurance_records_customer_month" ON "social_insurance_records" ("kind", "customer_id", "receipt_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_insurance_records_month" ON "social_insurance_records" ("receipt_month" DESC, "created_at" DESC, "id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_insurance_records_dept_month" ON "social_insurance_records" ("uploaded_by_department_id", "receipt_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_insurance_records_uploader_month" ON "social_insurance_records" ("uploaded_by", "receipt_month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_insurance_records_entry_staff" ON "social_insurance_records" ("entry_staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_insurance_records_collaborator" ON "social_insurance_records" ("collaborator_id");--> statement-breakpoint
-- Lọc theo khoảng ngày tạo (ngày tải file).
CREATE INDEX IF NOT EXISTS "social_insurance_records_created" ON "social_insurance_records" ("created_at");
