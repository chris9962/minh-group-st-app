-- Quyền `lookup`: tìm bằng CCCD đủ 12 số hoặc mở một bản ghi thì thấy toàn công
-- ty, ở bốn module khách, ngân hàng, bảo hiểm, VNeID (chốt 2026-10-10).
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm, cùng lối 0102. Phần cấp
-- `*:lookup` cho tài khoản toàn quyền nằm ở script `db:grant-lookup`, chạy SAU
-- migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'lookup';
