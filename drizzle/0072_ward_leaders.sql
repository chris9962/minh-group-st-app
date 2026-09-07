-- P-71 · Danh mục xã / ấp (chốt 2026-09-07): quyền riêng `system:configure-wards`
-- và thông tin trưởng xã / trưởng ấp trên hai bảng `wards`, `hamlets`.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm — drizzle bọc cả loạt
-- migration vào MỘT transaction, mà Postgres cấm dùng giá trị enum trong cùng
-- transaction với ADD VALUE (cùng lối migration 0046, 0050, 0052). Phần cấp
-- quyền cho Phó giám đốc và tài khoản toàn quyền nằm ở script
-- `db:grant-configure-wards`, chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'configure-wards';
--> statement-breakpoint

-- Rỗng nghĩa là chưa có, cùng lối `customers.province`. Không NULL để ô nhập
-- và câu tìm kiếm không phải phân biệt hai kiểu "trống".
ALTER TABLE "wards"
  ADD COLUMN IF NOT EXISTS "leader_name" text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS "leader_phone" text DEFAULT '' NOT NULL;
--> statement-breakpoint

ALTER TABLE "hamlets"
  ADD COLUMN IF NOT EXISTS "leader_name" text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS "leader_phone" text DEFAULT '' NOT NULL;
