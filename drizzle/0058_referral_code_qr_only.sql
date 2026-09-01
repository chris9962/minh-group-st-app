-- Một mã có thể chỉ có QR; tên hiển thị vẫn là định danh bắt buộc cho người dùng.
ALTER TABLE "referral_codes" ALTER COLUMN "code" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "referral_codes"
  ADD CONSTRAINT "referral_codes_text_or_qr"
  CHECK (nullif(btrim("code"), '') is not null OR "qr_image" is not null);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_bank_display_name"
  ON "referral_codes" ("bank_id", "display_name");
