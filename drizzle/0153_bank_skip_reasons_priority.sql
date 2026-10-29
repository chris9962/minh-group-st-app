-- Lý do không mở bank ưu tiên, mỗi hồ sơ khách một dòng (chốt 2026-10-29), thay lý do riêng MB của 0152.
-- `bank_ids` là các bank ưu tiên khách đủ tuổi mà chưa mở lúc ghi lý do. Bank ưu tiên đổi theo kỳ thể lệ nên phải lưu lại.
-- Lý do cũ đều của MB nên mỗi hồ sơ có tối đa một dòng, chuyển sang `bank_ids` = [MB].
ALTER TABLE "bank_skip_reasons" ADD COLUMN "bank_ids" uuid[];
--> statement-breakpoint
UPDATE "bank_skip_reasons" SET "bank_ids" = ARRAY["bank_id"];
--> statement-breakpoint
ALTER TABLE "bank_skip_reasons" ALTER COLUMN "bank_ids" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "bank_skip_reasons" ADD CONSTRAINT "bank_skip_reasons_banks" CHECK (cardinality("bank_ids") > 0);
--> statement-breakpoint
DROP INDEX IF EXISTS "bank_skip_reasons_customer_bank";
--> statement-breakpoint
ALTER TABLE "bank_skip_reasons" DROP COLUMN "bank_id";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_skip_reasons_customer" ON "bank_skip_reasons" ("customer_id");
