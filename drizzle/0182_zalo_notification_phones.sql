-- Thông báo Zalo gửi riêng nhận thêm số điện thoại nhập tay, cho người không có
-- hồ sơ nhân viên (chủ dự án yêu cầu 2026-11-19). Khoá theo tài khoản Zalo như
-- `zalo_notification_pgds`. `phone` lưu dạng 10 số `0xxxxxxxxx`.
CREATE TABLE IF NOT EXISTS "zalo_notification_phones" (
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"phone" text NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_notification_phones_pk" PRIMARY KEY ("account_id", "kind", "phone")
);
