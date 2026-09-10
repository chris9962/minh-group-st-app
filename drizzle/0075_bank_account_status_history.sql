ALTER TABLE "bank_accounts" ADD COLUMN "last_error_at" timestamptz;
--> statement-breakpoint
CREATE TABLE "bank_account_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE CASCADE,
  "from_status" "bank_account_status" NOT NULL,
  "to_status" "bank_account_status" NOT NULL,
  "changed_by" uuid REFERENCES "users"("id"),
  "changed_by_name" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "changed_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bank_account_history_account_time"
  ON "bank_account_status_history" ("account_id", "changed_at", "id");
