-- Bot Zalo chạy bằng tài khoản Zalo cá nhân qua zca-js (2026-09-25).
--
-- Phiên Zalo nằm trong worker `zalo:worker`, không nằm trong app Next: Zalo chỉ
-- cho mỗi tài khoản một listener, mà `next dev` nạp lại module là mở thêm một
-- kết nối. App và worker trao đổi qua hai bảng dưới.
--
-- `zalo_bot_state` có đúng một dòng. Worker ghi trạng thái, ảnh QR và nhịp tim.
-- App ghi `logout_requested_at` khi người quản trị bấm đăng xuất.
--
-- `zalo_outbox` là hàng chờ tin nhắn app nhờ worker gửi.
CREATE TABLE IF NOT EXISTS "zalo_bot_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"qr_image" text,
	"account_id" text,
	"account_name" text,
	"last_error" text,
	"heartbeat_at" timestamp with time zone,
	"logout_requested_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_bot_state_single_row" CHECK ("id" = 1),
	CONSTRAINT "zalo_bot_state_status" CHECK ("status" IN ('offline', 'waiting-qr', 'qr-scanned', 'connected', 'error'))
);--> statement-breakpoint
INSERT INTO "zalo_bot_state" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zalo_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" text NOT NULL,
	"thread_type" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "zalo_outbox_thread_type" CHECK ("thread_type" IN ('user', 'group')),
	CONSTRAINT "zalo_outbox_status" CHECK ("status" IN ('pending', 'sent', 'failed'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zalo_outbox_pending" ON "zalo_outbox" USING btree ("created_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zalo_outbox_created_at" ON "zalo_outbox" USING btree ("created_at" DESC NULLS LAST);
