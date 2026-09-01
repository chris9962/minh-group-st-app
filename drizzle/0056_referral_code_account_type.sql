ALTER TABLE "referral_codes"
  ADD COLUMN IF NOT EXISTS "account_type" "bank_account_type" NOT NULL DEFAULT 'none';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_codes_open_bank_type"
  ON "referral_codes" ("bank_id", "account_type")
  WHERE "active" = true;
