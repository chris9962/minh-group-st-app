-- Phôi bảo hiểm và phiếu ngân hàng thôi đếm tự động (chủ dự án chốt 2026-11-20),
-- kế hoạch ở docs/plan-phoi-nhap-con-lai-2026-11-20.md. Trigger đếm buộc app chặn
-- chuyển phòng; từ đây nhân viên tự báo số còn lại, app suy ra `used`.
--
-- Giữ `used_orders` và `bank_accounts.blank_department_id` tới lượt deploy sau:
-- script `db:blanks-manual` đọc `used_orders` ngay sau migrate.
DROP TRIGGER IF EXISTS insurance_orders_count_blank ON insurance_orders;--> statement-breakpoint
DROP TRIGGER IF EXISTS bank_accounts_count_blank ON bank_accounts;--> statement-breakpoint
DROP FUNCTION IF EXISTS mgst_count_insurance_blank();--> statement-breakpoint
DROP FUNCTION IF EXISTS mgst_bump_insurance_blank(uuid, text, insurance_product, integer, integer);--> statement-breakpoint
DROP FUNCTION IF EXISTS mgst_count_bank_blank();--> statement-breakpoint
DROP FUNCTION IF EXISTS mgst_bump_bank_blank(uuid, uuid, uuid, uuid, integer);--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "reported_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "reported_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
