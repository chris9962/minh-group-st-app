-- Phó giám đốc nhận thông báo Zalo gửi riêng (chốt 2026-10-12): báo cáo ngày,
-- mỗi PGĐ một tin tới SĐT trên hồ sơ. Khoá theo tài khoản Zalo như `zalo_notification_routes`.
CREATE TABLE IF NOT EXISTS "zalo_notification_pgds" (
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zalo_notification_pgds_pk" PRIMARY KEY ("account_id", "kind", "user_id")
);
