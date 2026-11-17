-- Quyền riêng cho việc đổi người tạo hồ sơ khách sang nhân viên cùng phòng
-- (chủ dự án chốt 2026-11-17). Trước migration này chỉ tài khoản toàn quyền làm được.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm, cùng lối 0134. Phần cấp
-- `*:change-owner` cho tài khoản toàn quyền nằm ở script
-- `db:grant-change-owner`, chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'change-owner';
