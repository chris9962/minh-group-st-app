-- Module Tích hợp VNeID (chốt 2026-10-02). Mỗi dòng là một lượt làm cho một
-- khách: đánh dấu việc đã làm (BHYT, ASXH, Chữ ký số) và tối đa 4 ảnh. Không
-- tính điểm KPI, tách hẳn khỏi `services`. Ngày thực hiện là `created_at`,
-- không có cột ngày riêng (chốt 2026-10-02). Mỗi hồ sơ khách đúng một dòng: làm
-- thêm việc thì sửa dòng đó, không thêm dòng mới.
--
-- Quyền riêng: module `vneid` với 6 hành động cơ bản. Không vai nào có sẵn trừ
-- Giám đốc (qua `*`); chủ dự án cấp lẻ ở P-92, cùng cách module Dịch vụ.
--
-- ADD VALUE chạy được trong transaction vì file này không dùng giá trị mới.
ALTER TYPE "module_key" ADD VALUE IF NOT EXISTS 'vneid' BEFORE 'system';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vneid_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "health_insurance" boolean NOT NULL DEFAULT false,
  "social_welfare" boolean NOT NULL DEFAULT false,
  "digital_signature" boolean NOT NULL DEFAULT false,
  "photo_urls" text[] NOT NULL DEFAULT '{}',
  "note" text NOT NULL DEFAULT '',
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_by_department_id" uuid REFERENCES "departments"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "vneid_records_has_task" CHECK ("health_insurance" OR "social_welfare" OR "digital_signature"),
  CONSTRAINT "vneid_records_photo_max" CHECK (cardinality("photo_urls") <= 4)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vneid_records_created" ON "vneid_records" ("created_at" DESC, "id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vneid_records_dept_created" ON "vneid_records" ("created_by_department_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vneid_records_creator_created" ON "vneid_records" ("created_by", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vneid_records_customer" ON "vneid_records" ("customer_id");
