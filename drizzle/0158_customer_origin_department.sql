-- Phòng lúc lập hồ sơ khách (chủ dự án chốt 2026-11-01). Luật Phòng Y đọc cột
-- này: cộng 0,1 cho Combo 2, Combo 3 từ kỳ 2026-11-01 và quy đổi quà TH8.
-- `created_by_department_id` vẫn đi theo người khi chuyển phòng; cột này không.
-- Hồ sơ đã có điền bằng `bun run db:backfill-origin-department`.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "origin_department_id" uuid REFERENCES "departments"("id");--> statement-breakpoint

-- Trigger ở DB vì hồ sơ khách được thêm từ nhiều đường (lập hồ sơ, nhập Excel
-- BHYT/BHXH, script); dặn từng đường nhớ điền thì có ngày một đường quên.
CREATE OR REPLACE FUNCTION mgst_fill_origin_department() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.origin_department_id IS NULL THEN
    NEW.origin_department_id := NEW.created_by_department_id;
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
DROP TRIGGER IF EXISTS customers_fill_origin_department ON "customers";--> statement-breakpoint
CREATE TRIGGER customers_fill_origin_department BEFORE INSERT ON "customers"
FOR EACH ROW EXECUTE FUNCTION mgst_fill_origin_department();
