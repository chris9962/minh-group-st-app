DROP INDEX "referral_codes_bank_code";
--> statement-breakpoint
DROP INDEX "referral_codes_bank_display_name";
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_bank_code"
  ON "referral_codes" ("bank_id", "account_type", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_bank_display_name"
  ON "referral_codes" ("bank_id", "account_type", "display_name");
