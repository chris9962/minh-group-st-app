-- `customers.gift_case` giữ mã bậc quà (`TH1`…`TH6`), đổi sang giữ DANH SÁCH MÃ
-- QUÀ khách đang được nhận.
--
-- Không ai đọc mã bậc. Ba chỗ dùng cột cũ đều chỉ hỏi "có null hay không":
-- `server/customers.ts` dựng nhãn trạng thái, `server/dashboard.ts` đếm khách
-- chờ phát, và chỉ mục một phần. Cột không trả ra client, không bộ lọc nào chọn
-- theo mã bậc, không màn nào hiện `TH3`.
--
-- Mã bậc trả lời sai một ca: khách chưa đủ tổ hợp ngân hàng nhưng có món thêm
-- (kênh Bệnh viện, CNKD/HKD) thì bậc là `null` mà rổ có món. Màn danh sách hiện
-- "Chưa đủ điều kiện" cho khách đang có 3 món phát được.
--
-- Danh sách mã trả lời đúng mọi ca: rổ rỗng nghĩa là không có gì để phát.
ALTER TABLE "customers" ADD COLUMN "gift_basket" text[] NOT NULL DEFAULT '{}';--> statement-breakpoint
-- Backfill thô: khách có bậc quà thì chắc chắn có rổ, tạm đánh dấu bằng một
-- phần tử giữ chỗ. `bun run db:recount` chạy ngay sau migration sẽ ghi đè bằng
-- danh sách thật — hàm luật nằm ở JavaScript nên SQL không dựng lại được.
UPDATE "customers" SET "gift_basket" = ARRAY['MIGRATION-PENDING']
 WHERE "gift_case" IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "customers_gift_case";--> statement-breakpoint
-- Chỉ mục một phần cho đúng câu hỏi mà hai chỗ đọc đặt ra: "khách nào còn quà
-- chưa phát". Đại đa số khách có rổ rỗng nên để chúng ngoài chỉ mục.
CREATE INDEX "customers_gift_basket" ON "customers" USING btree ("id")
 WHERE cardinality(gift_basket) > 0;--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "gift_case";
