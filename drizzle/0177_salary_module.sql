-- Module Lương (chốt 2026-11-16): xem lương, xuất lương, chốt lương, duyệt tạm
-- ứng và bước kế toán của tạm ứng tách khỏi module `staff` và `system`.
--
-- ADD VALUE chạy được trong transaction vì file này không dùng giá trị mới.
-- Quyền của tài khoản có sẵn chép sang bằng `bun run db:grant-salary`.
ALTER TYPE "module_key" ADD VALUE IF NOT EXISTS 'salary' BEFORE 'system';--> statement-breakpoint
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'pay-advance';
