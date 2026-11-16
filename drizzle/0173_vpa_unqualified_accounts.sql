-- Tài khoản VPa không đạt TMDK trong file chốt chỉ tiêu VPBank, đã trừ điểm combo vào lương `year_month` (chốt 2026-11-15).
CREATE TABLE "vpa_unqualified_accounts" (
	"bank_account_id" uuid PRIMARY KEY NOT NULL REFERENCES "bank_accounts"("id") ON DELETE cascade,
	"year_month" text NOT NULL,
	"points" numeric(10, 2) NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "vpa_unqualified_accounts_month" ON "vpa_unqualified_accounts" USING btree ("year_month");
