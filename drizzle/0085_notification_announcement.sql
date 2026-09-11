-- Thông báo chung toàn công ty, và quyền gửi nó.
--
-- Khác bốn loại đang chạy ở chỗ người gửi là NGƯỜI THẬT, không phải worker hay
-- một bước nghiệp vụ. Nên nó cần một quyền riêng: `system:send-announcement`.
--
-- ⚠️ File này KHÔNG được dùng hai giá trị enum vừa thêm — drizzle bọc cả loạt
-- migration vào MỘT transaction, mà Postgres cấm dùng giá trị enum trong cùng
-- transaction với `ADD VALUE` (cùng lối migration 0052 và 0084). Phần cấp
-- `*:send-announcement` cho tài khoản toàn quyền vì thế nằm ở script
-- `db:grant-send-announcement`, chạy SAU migrate.
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'announcement';
--> statement-breakpoint
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'send-announcement';
