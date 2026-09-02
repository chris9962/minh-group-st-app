ALTER TABLE "banks"
  ADD COLUMN IF NOT EXISTS "account_number_prefix" text NOT NULL DEFAULT '';
