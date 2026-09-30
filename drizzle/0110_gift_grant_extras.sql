-- Quà thêm HKD theo TỪNG tài khoản HKD (chủ dự án duyệt 2026-09-30, thể lệ kỳ
-- 2026-10-01 mục 4b: mỗi tài khoản HKD một món). Cột `gift_grants.extra_item`
-- chỉ giữ được một món cho cả khách, không nói được HKD nào chọn món nào khi
-- khách có hai tài khoản HKD.
--
-- `bank_account_id` null ở dòng chuyển từ cột cũ mà không tìm được dòng HKD của
-- khách, và ở dòng mà tài khoản HKD đã bị xoá sau lượt phát.
--
-- `ON DELETE SET NULL` ở cả hai khoá trỏ vào `bank_accounts`: màn chi tiết tài
-- khoản có nút Xoá tài khoản, thiếu nó thì xoá dòng HKD đã có quà thêm báo lỗi.
--
-- TODO(quà thêm HKD, lượt deploy sau bản này): cột `gift_grants.extra_item`
-- CỐ Ý giữ lại. `deploy/deploy.sh` tự lùi về bản cũ khi kiểm tra không đạt, mà
-- bản cũ còn đọc cột đó; bỏ cột ở đây thì lùi xong là màn khách hàng lỗi. Bỏ
-- cột bằng một migration riêng khi bản này đã chạy ổn.
CREATE TABLE IF NOT EXISTS "gift_grant_extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_grant_id" uuid NOT NULL REFERENCES "gift_grants"("id") ON DELETE cascade,
	"bank_account_id" uuid REFERENCES "bank_accounts"("id") ON DELETE SET NULL,
	"item" text NOT NULL,
	"chosen_by" uuid REFERENCES "users"("id"),
	"chosen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_grant_extras_slot" ON "gift_grant_extras" ("gift_grant_id", "bank_account_id") WHERE "bank_account_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_grant_extras_grant" ON "gift_grant_extras" ("gift_grant_id");
--> statement-breakpoint
ALTER TABLE "gift_grant_changes" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid REFERENCES "bank_accounts"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Chuyển món đã chọn sang dòng HKD của khách. Kỳ trước 2026-10-01 HKD chỉ kèm
-- VPa nên ưu tiên dòng VPa; tài khoản đã bị đánh lỗi sau lượt phát vẫn nhận,
-- vì món đã phát cho đúng dòng đó. `NOT EXISTS` để chạy lại không chép trùng.
INSERT INTO "gift_grant_extras" ("gift_grant_id", "bank_account_id", "item", "chosen_by", "chosen_at")
SELECT g."id",
	(SELECT ba."id" FROM "bank_accounts" ba JOIN "banks" b ON b."id" = ba."bank_id"
		WHERE ba."customer_id" = g."customer_id" AND ba."account_type" = 'HKD' AND ba."status" <> 'creating'
		ORDER BY (b."code" = 'VPa') DESC, ba."created_at" LIMIT 1),
	g."extra_item", g."granted_by", g."granted_at"
FROM "gift_grants" g
WHERE g."extra_item" IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM "gift_grant_extras" e WHERE e."gift_grant_id" = g."id");
