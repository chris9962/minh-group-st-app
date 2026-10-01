-- Trọng số điểm của loại dịch vụ theo tháng (chốt với chủ dự án 2026-10-01),
-- cùng cách với Chỉ tiêu tháng: tháng không có dòng dùng dòng gần nhất trước đó,
-- tháng đã chốt lương không sửa. Đổi trọng số tháng sau không làm đổi điểm
-- tháng trước. Thêm `over_cap_coefficient`: điểm mỗi lượt vượt trần ngày, mặc
-- định 0 (Chi BTXH: 10 lượt đầu mỗi ngày 0,1 điểm, từ lượt thứ 11 là 0,05).
--
-- Dời hệ số và trần đang có ở `service_types` sang tháng 2026-10, tháng đầu của
-- thông báo lương Điểm ATM, rồi bỏ các cột đó. Bước này chỉ dời giá trị đang
-- có, không ghi mức điểm nào; mức điểm vẫn ghi bằng `db:seed-atm-2026-10`.
CREATE TABLE IF NOT EXISTS "service_type_months" (
  "service_type_id" uuid NOT NULL REFERENCES "service_types"("id") ON DELETE CASCADE,
  "year_month" text NOT NULL,
  "coefficient" numeric(4, 2) NOT NULL,
  "daily_cap" integer,
  "over_cap_coefficient" numeric(4, 2) DEFAULT '0' NOT NULL,
  "monthly_cap" integer,
  "updated_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone,
  CONSTRAINT "service_type_months_pk" PRIMARY KEY ("service_type_id", "year_month"),
  CONSTRAINT "service_type_months_year_month" CHECK ("year_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "service_type_months_values" CHECK ("coefficient" >= 0 and "over_cap_coefficient" >= 0 and coalesce("daily_cap", 1) > 0 and coalesce("monthly_cap", 1) > 0)
);
--> statement-breakpoint
INSERT INTO "service_type_months" ("service_type_id", "year_month", "coefficient", "daily_cap", "monthly_cap")
SELECT "id", '2026-10', "coefficient", "daily_cap", "monthly_cap" FROM "service_types"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "service_types" DROP CONSTRAINT IF EXISTS "service_types_caps_positive";
--> statement-breakpoint
ALTER TABLE "service_types" DROP COLUMN IF EXISTS "coefficient";
--> statement-breakpoint
ALTER TABLE "service_types" DROP COLUMN IF EXISTS "daily_cap";
--> statement-breakpoint
ALTER TABLE "service_types" DROP COLUMN IF EXISTS "monthly_cap";
