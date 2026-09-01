ALTER TABLE "banks"
  ADD COLUMN IF NOT EXISTS "min_age" smallint,
  ADD COLUMN IF NOT EXISTS "max_age" smallint;
--> statement-breakpoint
ALTER TABLE "banks"
  ADD CONSTRAINT "banks_min_age_non_negative" CHECK ("min_age" IS NULL OR "min_age" >= 0),
  ADD CONSTRAINT "banks_max_age_non_negative" CHECK ("max_age" IS NULL OR "max_age" >= 0),
  ADD CONSTRAINT "banks_age_range_valid" CHECK ("min_age" IS NULL OR "max_age" IS NULL OR "min_age" <= "max_age");
