-- Cấp lại đơn bảo hiểm (chốt 2026-09-03). Đơn đã hoàn thành mà sai thì không
-- sửa được nữa; đường chữa là huỷ rồi lập đơn mới. Cột này nối đơn mới về đơn
-- nó thay, để đối soát với PVI còn tra ngược được.
--
-- UNIQUE là điều kiện chặn cấp lại lần hai: một đơn huỷ chỉ đẻ ra đúng một đơn
-- thay thế. Chặn ở database chứ không chỉ ở máy chủ — hai lượt bấm cùng lúc thì
-- phép kiểm ở tầng ứng dụng đọc cùng một trạng thái cũ và cho qua cả hai.
ALTER TABLE "insurance_orders"
  ADD COLUMN "replaces_order_id" uuid REFERENCES "insurance_orders"("id");
--> statement-breakpoint

CREATE UNIQUE INDEX "insurance_orders_replaces" ON "insurance_orders" ("replaces_order_id");
