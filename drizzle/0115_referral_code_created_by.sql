-- Người tạo mã giới thiệu, hiện ở tab Kho mã giới thiệu (chốt 2026-10-01).
--
-- Mã có sẵn lấy người tạo từ dòng "Thêm mã giới thiệu" trong `audit_log`. Mã
-- không có dòng đó thì để NULL, giao diện hiện "—".
ALTER TABLE "referral_codes" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
UPDATE "referral_codes" rc
SET "created_by" = a."actor_id"
FROM (
  SELECT DISTINCT ON ("target_id") "target_id", "actor_id"
  FROM "audit_log"
  WHERE "target_table" = 'referral_codes' AND "action" = 'create'
  ORDER BY "target_id", "at"
) a
WHERE a."target_id" = rc."id"::text AND rc."created_by" IS NULL;
