-- Tích hợp VNeID thêm 3 việc (chốt 2026-10-06): Sổ SKĐT, GPLX, Cavet xe.
-- Dòng cũ nhận `false`, nên check "ít nhất một việc" vẫn đúng với dữ liệu có sẵn.
ALTER TABLE "vneid_records" ADD COLUMN IF NOT EXISTS "health_record" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "vneid_records" ADD COLUMN IF NOT EXISTS "driving_license" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "vneid_records" ADD COLUMN IF NOT EXISTS "vehicle_registration" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "vneid_records" DROP CONSTRAINT IF EXISTS "vneid_records_has_task";--> statement-breakpoint
ALTER TABLE "vneid_records" ADD CONSTRAINT "vneid_records_has_task" CHECK (
  "health_insurance" OR "social_welfare" OR "digital_signature"
  OR "health_record" OR "driving_license" OR "vehicle_registration"
);
