-- Loại thông báo "có mã giới thiệu CNKD mới" (chốt 2026-09-19): gửi cho MỌI
-- nhân viên đang hoạt động khi người quản ngân hàng thêm một mã loại CNKD.
-- Có công tắc ở trang cá nhân, khác `announcement`.
-- Cùng lối 0092: chỉ thêm giá trị enum, không dùng trong cùng lượt migrate.
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'code-cnkd';
--> statement-breakpoint
