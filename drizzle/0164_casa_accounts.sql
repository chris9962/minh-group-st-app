-- Tài khoản đạt CASA nhập từ file ngân hàng; file tháng M tính vào lương tháng M+1 (chốt 2026-11-09).
CREATE TABLE "casa_accounts" (
	"bank_account_id" uuid PRIMARY KEY NOT NULL REFERENCES "bank_accounts"("id") ON DELETE cascade,
	"year_month" text NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "casa_accounts_month" ON "casa_accounts" USING btree ("year_month");
