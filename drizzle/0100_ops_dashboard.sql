-- P-99 · Màn Vận hành hệ thống, và hai bảng nuôi nó.
--
-- `host_metrics` là số đo CPU / RAM / ổ đĩa / S3 do script `ops:watch` ghi mỗi
-- phút. App chỉ ĐỌC bảng này: container không nhìn được ổ đĩa của máy chủ, nên
-- đo tại chỗ trong app ra số của container chứ không ra số của máy.
--
-- `ops_alerts` là sổ chống gửi trùng. Một đơn chờ giấy chứng nhận quá 10 phút
-- chỉ báo một lần ở mốc 10 phút và một lần ở mốc 15 phút; không có sổ thì mỗi
-- vòng chạy lại gửi lại đúng đơn đó.
--
-- ⚠️ File này KHÔNG được dùng hai giá trị enum vừa thêm. Drizzle bọc cả loạt
-- migration vào MỘT transaction, mà Postgres cấm dùng giá trị enum trong cùng
-- transaction với `ALTER TYPE … ADD VALUE` (cùng lối 0085). Phần cấp
-- `*:view-ops` cho tài khoản toàn quyền vì thế nằm ở script `db:grant-view-ops`,
-- chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'view-ops';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'ops-alert';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "host_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"cpu_percent" numeric(5, 2) NOT NULL,
	"ram_used" bigint NOT NULL,
	"ram_total" bigint NOT NULL,
	"disk_used" bigint NOT NULL,
	"disk_total" bigint NOT NULL,
	"s3_bytes" bigint,
	"s3_objects" bigint,
	"s3_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "host_metrics_at" ON "host_metrics" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
