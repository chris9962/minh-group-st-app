-- Khách đóng lần đầu nhiều tháng có hai dòng cùng tháng biên lai: một Tăng mới, một Tái tục (chốt 2026-11-14).
-- Chỉ mục duy nhất thêm cột phương án; tải lại cùng file vẫn không ghi trùng.
DROP INDEX IF EXISTS "social_insurance_records_customer_month";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_insurance_records_customer_month_plan" ON "social_insurance_records" ("kind", "customer_id", "receipt_month", "plan");
