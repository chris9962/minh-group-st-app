-- Chia chỗ của một mã giới thiệu cho từng nhân viên (chốt 2026-10-19). Mã có
-- dòng ở đây thì CHỈ người được chia dùng được, mỗi người đúng `quota` chỗ,
-- tính cả tài khoản đang mở dở. Mã không có dòng nào giữ luật theo phòng.
--
-- Số đã dùng của từng người KHÔNG lưu: đếm sống từ `bank_accounts` theo
-- (referral_code_id, created_by) — mỗi mã tối đa vài trăm dòng, và phép kiểm
-- "còn chỗ riêng" chạy sau khi đã khoá dòng `referral_codes`.
--
-- `per_user_allocation`: kho mã bật cho mã gán đúng MỘT phòng. Bật thì mã chỉ
-- dùng được qua phần chia; chưa chia cho ai thì chưa ai dùng được. Tắt (mặc
-- định, mọi mã đang có) thì cả phòng dùng như trước.
ALTER TABLE "referral_codes" ADD COLUMN IF NOT EXISTS "per_user_allocation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_code_allocations" (
	"referral_code_id" uuid NOT NULL REFERENCES "referral_codes"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"quota" integer NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_code_allocations_referral_code_id_user_id_pk" PRIMARY KEY("referral_code_id","user_id"),
	CONSTRAINT "referral_code_allocations_quota_positive" CHECK ("quota" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_code_allocations_user" ON "referral_code_allocations" USING btree ("user_id");
