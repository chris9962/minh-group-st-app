-- Tên nhận diện nội bộ của mã/QR. Dữ liệu cũ dùng chính mã text làm tên để
-- không đổi cách nhân viên đang nhận biết từng bản ghi.
ALTER TABLE "referral_codes" ADD COLUMN "display_name" text;
--> statement-breakpoint
UPDATE "referral_codes" SET "display_name" = "code";
--> statement-breakpoint
ALTER TABLE "referral_codes" ALTER COLUMN "display_name" SET NOT NULL;
