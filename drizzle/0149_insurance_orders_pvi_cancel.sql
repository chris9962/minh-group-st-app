-- Job huỷ đơn trên PVI Connect (`pvi-cancel-orders/`) ghi số đơn gom chứa đơn huỷ và lúc đơn đã
-- huỷ trên PVI (chốt 2026-10-24). Thông báo Zalo lúc 00:00 tìm đơn huỷ chưa huỷ trên PVI theo cột
-- `pvi_cancelled_at`.
ALTER TABLE "insurance_orders" ADD COLUMN IF NOT EXISTS "pvi_cancel_merged_number" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD COLUMN IF NOT EXISTS "pvi_cancelled_at" timestamp with time zone;
