-- Thông báo "ảnh chưa đạt xác thực" cho nhân viên tạo tài khoản (chốt 2026-09-12).
--
-- Worker xác thực ảnh gửi tin này khi lượt kiểm xong mà có phép kiểm không đạt
-- hay thiếu ảnh, để nhân viên sửa ảnh trong ngày trước khi người duyệt đánh lỗi.
-- Tắt được ở trang cá nhân như các loại ngân hàng khác.
--
-- ⚠️ Không dùng giá trị enum vừa thêm trong file này, cùng lý do migration 0085.
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'bank-photo-fail';
--> statement-breakpoint

-- Lượt kiểm có báo tin hay không. Script quét bù `db:enqueue-photo-checks` ghi
-- false: tài khoản cũ hàng nghìn cái, báo cho nhân viên là dội tin về việc đã
-- qua. Lượt do Hoàn thành hay đổi ảnh tạo ra thì true.
ALTER TABLE "bank_account_checks" ADD COLUMN IF NOT EXISTS "notify" boolean DEFAULT true NOT NULL;
--> statement-breakpoint

-- Lô quét bù đêm 2026-09-12 đã xong trước khi có cột, không báo lại.
UPDATE "bank_account_checks" SET "notify" = false;
