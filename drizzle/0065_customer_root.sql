-- Một khách mở NHIỀU LẦN, mỗi lần một hồ sơ riêng (chốt 2026-09-05).
--
-- Thể lệ cho một người mở nhiều combo và nhận nhiều quà, nhưng luật điểm và quà
-- gom theo HỒ SƠ khách: một hồ sơ một combo, một bậc TH, một đợt `gift_grants`.
-- Đổi luật đó là đụng `src/rules`, tức đụng lương.
--
-- Nên lần thứ hai của cùng một người là một hồ sơ MỚI, và `root_customer_id`
-- nối các lần lại. Hồ sơ gốc trỏ về CHÍNH NÓ, không để `null`: có `null` thì
-- mọi câu hỏi "mọi lần của khách này" phải viết `id = X or root_customer_id = X`
-- — hai cách viết cho một ý, sớm muộn có chỗ quên một vế.
ALTER TABLE "customers" ADD COLUMN "root_customer_id" uuid;
--> statement-breakpoint

UPDATE "customers" SET "root_customer_id" = "id";
--> statement-breakpoint

ALTER TABLE "customers" ALTER COLUMN "root_customer_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "customers" ADD CONSTRAINT "customers_root_customer_id_customers_id_fk"
  FOREIGN KEY ("root_customer_id") REFERENCES "public"."customers"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Đồng bộ tên/ngày sinh/CCCD và tra "khách này đã mở ngân hàng nào" đều lọc
-- theo cột này.
CREATE INDEX "customers_root" ON "customers" ("root_customer_id");
--> statement-breakpoint

-- Lần thứ mấy của người này. Hồ sơ gốc là 1, mỗi lần sau cộng một.
--
-- Chỉ để HIỂN THỊ: bảng khách và ô tìm khách hiện "lần 2" ngay trên dòng, người
-- dùng không phải mở từng hồ sơ ra đối chiếu ngân hàng đã mở.
--
-- Lưu chứ không đếm sống. Đếm sống thì mỗi lượt mở danh sách phải chạy thêm một
-- phép gộp theo nhóm trên bảng khách, và số thứ tự đổi khi ai đó xoá một hồ sơ
-- ở giữa — dòng "lần 3" hôm trước thành "lần 2" hôm sau.
ALTER TABLE "customers" ADD COLUMN "seq" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint

-- CCCD duy nhất trong phạm vi HỒ SƠ GỐC, không phải toàn bảng.
--
-- Hồ sơ lần 2 mang đúng CCCD của lần 1 nên khoá cũ từ chối nó. Điều kiện
-- `root_customer_id = id` chỉ chừa hồ sơ gốc lại: vẫn không có hai hồ sơ gốc
-- cùng CCCD, mà hồ sơ con thì không vướng.
DROP INDEX "customers_id_number";
--> statement-breakpoint

CREATE UNIQUE INDEX "customers_id_number" ON "customers" ("id_number")
  WHERE id_number is not null and root_customer_id = id;
--> statement-breakpoint

ALTER TABLE "bank_accounts" ADD COLUMN "root_customer_id" uuid;
--> statement-breakpoint

UPDATE "bank_accounts" ba
  SET "root_customer_id" = c."root_customer_id"
  FROM "customers" c
  WHERE c."id" = ba."customer_id";
--> statement-breakpoint

ALTER TABLE "bank_accounts" ALTER COLUMN "root_customer_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_root_customer_id_customers_id_fk"
  FOREIGN KEY ("root_customer_id") REFERENCES "public"."customers"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Một ngân hàng chỉ MỘT lần cho mỗi người, tính qua mọi lần của họ.
--
-- Khoá cũ `(customer_id, bank_id)` chỉ chặn trong một hồ sơ, nên lần 2 mở lại MB
-- vẫn qua. Ràng buộc phải nằm trên `bank_accounts` chứ không kiểm bằng trigger:
-- trigger đọc rồi mới chèn nên hai request cùng lúc qua được cả hai.
DROP INDEX "bank_accounts_customer_bank";
--> statement-breakpoint

CREATE UNIQUE INDEX "bank_accounts_root_bank" ON "bank_accounts" ("root_customer_id", "bank_id");
