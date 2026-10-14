-- Phòng Thanh tra đánh dấu hồ sơ khách đã kiểm tra (chốt 2026-10-14). Theo
-- từng hồ sơ, không theo nhóm CCCD. Chỉ người có customer:lookup đọc và ghi.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "inspected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "inspected_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "inspected_by_name" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "inspected_note" text NOT NULL DEFAULT '';
