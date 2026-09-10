-- Đường API đối tác PVI chạy song song với bot Playwright.
--
-- Bốn cột mới đều RIÊNG của đường API, không dùng chung cột nào của bot. Bot ghi
-- `pvi_pr_key` dạng chuỗi `W6fXX4Fd7+I=` và `pvi_electronic_order_no` đọc bằng
-- mắt từ bảng `/Service/Manager`; API trả `Pr_key` dạng số và `PolicyNumber` qua
-- lệnh gọi. Trộn hai nguồn vào một cột thì mọi chỗ đọc phải đoán đơn đi đường
-- nào (chốt 2026-09-03).
ALTER TABLE "insurance_orders" ADD COLUMN "pvi_route" text NOT NULL DEFAULT '';
ALTER TABLE "insurance_orders" ADD COLUMN "pvi_policy_number" text NOT NULL DEFAULT '';
ALTER TABLE "insurance_orders" ADD COLUMN "pvi_pr_key_number" bigint;
ALTER TABLE "insurance_orders" ADD COLUMN "pvi_attempts" smallint NOT NULL DEFAULT 0;

-- Hai worker lấy đơn theo cặp trạng thái cộng đường đi.
CREATE INDEX "insurance_orders_route" ON "insurance_orders" ("status", "pvi_route");

-- Đơn đang dở dang lúc chạy migration đều của bot: đường API chưa từng chạy
-- thật. Không backfill thì worker bot mất sạch hàng chờ ngay sau khi triển khai,
-- vì câu lấy đơn của nó thêm điều kiện `pvi_route = 'bot'`.
UPDATE "insurance_orders"
   SET "pvi_route" = 'bot'
 WHERE "status" IN ('queued', 'creating', 'pending-approval', 'awaiting-certificate');
