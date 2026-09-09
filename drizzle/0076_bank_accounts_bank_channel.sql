CREATE INDEX "bank_accounts_bank_channel_opened"
  ON "bank_accounts" (
    "bank_id",
    "channel_id",
    "opened_date" DESC NULLS LAST,
    "created_at" DESC,
    "id"
  );
