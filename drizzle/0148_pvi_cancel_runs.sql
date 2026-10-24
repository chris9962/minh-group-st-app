-- Kết quả từng lượt chạy của job huỷ đơn trên PVI Connect (`pvi-cancel-orders/`).
-- Job ghi một dòng sau mỗi lượt; worker Zalo đọc dòng mới để gửi thông báo
-- `pvi-cancel-report` (chốt 2026-10-24). `report` là JSON job tự dựng.
CREATE TABLE IF NOT EXISTS "pvi_cancel_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_date" date NOT NULL,
	"mode" text NOT NULL,
	"report" jsonb NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pvi_cancel_runs_mode" CHECK ("mode" in ('write', 'check'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pvi_cancel_runs_created_at" ON "pvi_cancel_runs" ("created_at");
