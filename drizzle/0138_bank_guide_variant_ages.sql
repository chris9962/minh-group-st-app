-- Giới hạn tuổi riêng cho CNKD/HKD (chốt 2026-10-12). Để trống là không giới
-- hạn, không lấy tuổi của bản Thường.
ALTER TABLE "bank_guide_variants"
  ADD COLUMN IF NOT EXISTS "min_age" smallint,
  ADD COLUMN IF NOT EXISTS "max_age" smallint;
--> statement-breakpoint
ALTER TABLE "bank_guide_variants"
  ADD CONSTRAINT "bank_guide_variants_min_age_non_negative" CHECK ("min_age" IS NULL OR "min_age" >= 0),
  ADD CONSTRAINT "bank_guide_variants_max_age_non_negative" CHECK ("max_age" IS NULL OR "max_age" >= 0),
  ADD CONSTRAINT "bank_guide_variants_age_range_valid" CHECK ("min_age" IS NULL OR "max_age" IS NULL OR "min_age" <= "max_age");
