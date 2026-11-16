-- Ảnh khách nhận quà của tài khoản ShopeePay (chốt 2026-11-16). Kỳ 2026-11-11 cộng thêm 0,2 cho ShopeePay khi có ảnh này.
-- Postgres 12 trở lên cho phép ADD VALUE trong transaction, miễn là không dùng giá trị mới trong cùng transaction.
ALTER TYPE "photo_kind" ADD VALUE IF NOT EXISTS 'gift';
