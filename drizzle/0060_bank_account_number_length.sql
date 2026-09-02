ALTER TABLE "banks"
  ADD COLUMN IF NOT EXISTS "account_number_length" smallint;
--> statement-breakpoint
ALTER TABLE "banks"
  ADD CONSTRAINT "banks_account_number_length_positive"
  CHECK ("account_number_length" IS NULL OR "account_number_length" > 0);
