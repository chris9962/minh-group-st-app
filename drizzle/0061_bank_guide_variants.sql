-- Bản hướng dẫn theo loại tài khoản CNKD/HKD (chốt 2026-09-02).
-- VPa/VPb mở CNKD/HKD theo quy trình khác bản thường: hướng dẫn, ảnh mẫu và
-- số ảnh bắt buộc đều khác. Ba bản TÁCH HẲN nhau: loại chưa cài thì không có
-- hướng dẫn, không lấy bản thường thay; luật "đủ ảnh mới cho Hoàn thành" đếm
-- theo bản của đúng loại. Dòng cũ chưa lưu lại thì số ảnh lui về số của
-- ngân hàng — 0 ảnh không được là mặc định.

ALTER TABLE "bank_guide_photos"
  ADD COLUMN "account_type" "bank_account_type" NOT NULL DEFAULT 'none';
--> statement-breakpoint

CREATE TABLE "bank_guide_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bank_id" uuid NOT NULL REFERENCES "banks"("id"),
  "account_type" "bank_account_type" NOT NULL,
  "required_photos" smallint NOT NULL DEFAULT 3,
  "guide" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "bank_guide_variants_type" CHECK (account_type in ('CNKD', 'HKD')),
  CONSTRAINT "bank_guide_variants_photos" CHECK (required_photos >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX "bank_guide_variants_bank_type"
  ON "bank_guide_variants" ("bank_id", "account_type");
