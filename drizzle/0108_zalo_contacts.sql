-- Gửi tin Zalo theo số điện thoại (2026-09-28).
--
-- Zalo chỉ gửi tin theo uid, không theo số điện thoại. Worker tra uid trong
-- danh sách bạn bè của tài khoản bot, không có thì tra bằng `findUser`, rồi lưu
-- vào `zalo_contacts`. Lần sau gặp lại số đó, worker đọc bảng, không tra lại.
--
-- `zalo_contacts` khoá theo `account_id` như `zalo_groups`: đổi tài khoản bot
-- thì worker tra lại từ đầu. `phone` lưu dạng 10 số `0xxxxxxxxx`.
--
-- `zalo_outbox`: dòng gửi theo số điện thoại có `phone`, `thread_id` rỗng tới
-- khi worker tra ra uid. Hai chỉ mục phục vụ khung chat của màn Bot Zalo: đọc
-- tin đã gửi của một nơi nhận.
CREATE TABLE IF NOT EXISTS "zalo_contacts" (
	"account_id" text NOT NULL,
	"phone" text NOT NULL,
	"uid" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_contacts_pk" PRIMARY KEY ("account_id", "phone")
);--> statement-breakpoint
ALTER TABLE "zalo_outbox" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "zalo_outbox" ALTER COLUMN "thread_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "zalo_outbox" DROP CONSTRAINT IF EXISTS "zalo_outbox_target";--> statement-breakpoint
ALTER TABLE "zalo_outbox" ADD CONSTRAINT "zalo_outbox_target" CHECK ("thread_id" IS NOT NULL OR "phone" IS NOT NULL);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zalo_outbox_thread" ON "zalo_outbox" USING btree ("thread_id", "created_at" DESC) WHERE "thread_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zalo_outbox_phone" ON "zalo_outbox" USING btree ("phone", "created_at" DESC) WHERE "phone" IS NOT NULL;
