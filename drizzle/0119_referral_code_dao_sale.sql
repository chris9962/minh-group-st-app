-- Mã DAO SALE của VPa, VPb (chốt 2026-10-03). App VPBank NEO có hai ô liền nhau:
-- "DAO SALE" và "MÃ GIỚI THIỆU". Mã text giữ ô MÃ GIỚI THIỆU, cột này giữ ô DAO
-- SALE; kiểm ảnh so nguyên văn từng ô với đúng cột của nó.
--
-- Không chuyển dữ liệu: người nhập liệu tự điền hai cột cho mã VPa, VPb.
ALTER TABLE "referral_codes" ADD COLUMN IF NOT EXISTS "dao_sale" text;
--> statement-breakpoint
ALTER TABLE "referral_codes" DROP CONSTRAINT IF EXISTS "referral_codes_text_or_qr";
--> statement-breakpoint
ALTER TABLE "referral_codes"
  ADD CONSTRAINT "referral_codes_text_or_qr"
  CHECK (
    nullif(btrim("code"), '') is not null
    OR nullif(btrim("dao_sale"), '') is not null
    OR "qr_image" is not null
  );
