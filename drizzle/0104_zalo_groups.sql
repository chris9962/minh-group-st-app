-- Nhóm Zalo và thông báo tự động của bot Zalo (2026-09-25).
--
-- Cả ba bảng khoá theo `account_id`, là ID Zalo của tài khoản bot. Đổi sang
-- tài khoản khác thì màn Bot Zalo hiện nhóm và cấu hình của tài khoản đó; quay
-- lại tài khoản cũ thì cấu hình cũ vẫn còn.
--
-- `zalo_groups`: worker thay trọn nhóm của tài khoản mỗi lần đăng nhập và mỗi
-- lần bấm tải lại. Zalo không báo nhóm nào mới vào hay vừa rời.
--
-- `zalo_notification_routes`: loại thông báo nào gửi tới nhóm nào. Không có khoá
-- ngoại sang `zalo_groups`: mỗi lượt tải nhóm xoá rồi chèn lại, khoá ngoại sẽ
-- xoá luôn cấu hình. Worker chỉ gửi tới nhóm còn trong `zalo_groups`.
--
-- `zalo_notification_log`: sổ chống gửi trùng, một dòng một sự việc đã báo, ví
-- dụ `insurance-certificate-overdue:<id đơn>`.
ALTER TABLE "zalo_bot_state" ADD COLUMN IF NOT EXISTS "groups_sync_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zalo_bot_state" ADD COLUMN IF NOT EXISTS "groups_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zalo_groups" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"search_name" text GENERATED ALWAYS AS (mgst_normalize(name)) STORED,
	"member_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "zalo_groups_pk" PRIMARY KEY ("account_id", "id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zalo_groups_account_name" ON "zalo_groups" USING btree ("account_id", "name");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zalo_notification_routes" (
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"group_id" text NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_notification_routes_pk" PRIMARY KEY ("account_id", "kind", "group_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zalo_notification_log" (
	"key" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
