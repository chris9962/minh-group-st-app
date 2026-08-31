ALTER TYPE "bank_account_status" ADD VALUE IF NOT EXISTS 'error';
--> statement-breakpoint
ALTER TABLE "bank_accounts"
  ADD COLUMN IF NOT EXISTS "error_note" text DEFAULT '' NOT NULL;
