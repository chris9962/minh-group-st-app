-- Người duyệt xác nhận ảnh đạt dù máy chấm không đạt (chốt 2026-09-12).
--
-- OCR đọc sai thì người duyệt xem ảnh, thấy đúng, bấm "Xác nhận đạt". Kết quả
-- máy giữ nguyên trong `result` để còn biết máy sai gì; hai cột này ghi ai xác
-- nhận và lúc nào. Điểm hiệu lực = xác nhận rồi thì đạt hết, chưa thì điểm máy.
--
-- Nhân viên đổi ảnh là một lượt kiểm mới, không mang xác nhận cũ.
ALTER TABLE "bank_account_checks" ADD COLUMN IF NOT EXISTS "confirmed_by" uuid;
--> statement-breakpoint
ALTER TABLE "bank_account_checks" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "bank_account_checks" ADD CONSTRAINT "bank_account_checks_confirmed_by_users_id_fk"
  FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
