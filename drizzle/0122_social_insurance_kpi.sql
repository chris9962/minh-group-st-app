-- Mức điểm KPI An Sinh theo tháng (spec docs/spec-bhyt-bhxh-an-sinh.md mục 2.2):
-- doanh thu bao nhiêu đồng thì được 1 điểm, theo loại và phương án. Tháng không
-- có dòng nào thì dùng bộ của tháng gần nhất trước đó. Số tháng 2026-10 nằm ở
-- script `db:seed-social-insurance`.
CREATE TABLE IF NOT EXISTS "social_insurance_kpi_rates" (
  "year_month" text NOT NULL,
  "kind" "social_insurance_kind" NOT NULL,
  "plan" "social_insurance_plan" NOT NULL,
  "revenue_per_point" integer NOT NULL,
  "updated_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("year_month", "kind", "plan"),
  CONSTRAINT "social_insurance_kpi_rates_year_month" CHECK ("year_month" ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT "social_insurance_kpi_rates_positive" CHECK ("revenue_per_point" > 0)
);
