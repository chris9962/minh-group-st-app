-- Giới hạn tuổi riêng của một mã giới thiệu (chốt 2026-10-20). Cộng thêm vào
-- luật tuổi của ngân hàng, không thay nó: khách phải qua cả hai mới thấy mã.
-- Để trống là không giới hạn, nên mọi mã đang có giữ nguyên cách dùng.
ALTER TABLE "referral_codes"
  ADD COLUMN IF NOT EXISTS "min_age" smallint,
  ADD COLUMN IF NOT EXISTS "max_age" smallint;
--> statement-breakpoint
ALTER TABLE "referral_codes"
  ADD CONSTRAINT "referral_codes_min_age_non_negative" CHECK ("min_age" IS NULL OR "min_age" >= 0),
  ADD CONSTRAINT "referral_codes_max_age_non_negative" CHECK ("max_age" IS NULL OR "max_age" >= 0),
  ADD CONSTRAINT "referral_codes_age_range_valid" CHECK ("min_age" IS NULL OR "max_age" IS NULL OR "min_age" <= "max_age");
