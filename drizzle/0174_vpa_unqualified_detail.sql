-- Chụp điểm combo và ngân hàng của khách trước, sau khi tài khoản VPa không đạt, để nhân viên xem chi tiết dòng điểm trừ (chốt 2026-11-16).
ALTER TABLE "vpa_unqualified_accounts" ADD COLUMN "adjustment_id" uuid REFERENCES "kpi_adjustments"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "vpa_unqualified_accounts" ADD COLUMN "points_before" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "vpa_unqualified_accounts" ADD COLUMN "points_after" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "vpa_unqualified_accounts" ADD COLUMN "banks_before" text[];
--> statement-breakpoint
ALTER TABLE "vpa_unqualified_accounts" ADD COLUMN "banks_after" text[];
--> statement-breakpoint
CREATE INDEX "vpa_unqualified_accounts_adjustment" ON "vpa_unqualified_accounts" USING btree ("adjustment_id");
