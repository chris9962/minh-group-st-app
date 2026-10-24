-- Chức vụ Quản trị viên (`admin`), chạy như Giám đốc ở mọi chỗ code đọc chức vụ
-- Giám đốc (chốt 2026-10-24). Đứng ngay sau `director` trong enum.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm, cùng lối 0134. Đổi chức vụ
-- của tài khoản `admin` làm SAU migrate, ở form sửa nhân viên.
ALTER TYPE "role_key" ADD VALUE IF NOT EXISTS 'admin' AFTER 'director';
