-- Kiểm ảnh chứng minh tài khoản ngân hàng bằng OCR (chốt 2026-09-11).
--
-- Worker `scripts/photo-check-worker.ts` đọc chữ trên ảnh bằng Tesseract rồi so
-- với hệ thống: mã giới thiệu trên màn mở tài khoản, tên khách trên màn hình
-- chính, màn chuyển khoản thành công. Kết quả chỉ để GỢI Ý cho người duyệt,
-- không tự đổi bank_accounts.status.
--
-- Nhiều dòng một tài khoản: nhân viên đổi ảnh là một lượt mới, màn đọc lượt mới
-- nhất. Ngân hàng chưa có bộ nhãn thì không có dòng nào.
CREATE TYPE "bank_account_check_status" AS ENUM ('pending', 'done', 'failed');
--> statement-breakpoint

CREATE TABLE "bank_account_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "status" "bank_account_check_status" DEFAULT 'pending' NOT NULL,
  -- PhotoCheckResult ở lib/api/photoCheck.ts. NULL khi chưa xong hoặc hỏng.
  "result" jsonb,
  -- Số phép kiểm đạt trên tổng số, worker ghi cùng lúc với result. Lưu riêng
  -- để bảng lọc "có điểm không đạt" bằng hai cột số, không phải đọc jsonb.
  "passed" smallint DEFAULT 0 NOT NULL,
  "total" smallint DEFAULT 0 NOT NULL,
  -- Lý do worker hỏng, chỉ khi status = failed.
  "error" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checked_at" timestamp with time zone
);
--> statement-breakpoint

-- Cascade như ảnh: lượt kiểm chết theo tài khoản.
ALTER TABLE "bank_account_checks" ADD CONSTRAINT "bank_account_checks_account_id_bank_accounts_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Màn đọc "lượt mới nhất của tài khoản này".
CREATE INDEX "bank_account_checks_account_time" ON "bank_account_checks" ("account_id", "created_at");
--> statement-breakpoint

-- Worker đọc "dòng pending cũ nhất".
CREATE INDEX "bank_account_checks_pending" ON "bank_account_checks" ("status", "created_at");
