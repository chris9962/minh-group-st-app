DROP INDEX "insurance_orders_dept_date";--> statement-breakpoint
DROP INDEX "insurance_orders_creator_date";--> statement-breakpoint
DROP INDEX "insurance_orders_date";--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD COLUMN "order_date" date DEFAULT current_date NOT NULL;--> statement-breakpoint
/*
 * Đơn cũ: lấy ngày tạo dòng dữ liệu làm ngày tạo đơn.
 *
 * PHẢI quy về giờ Việt Nam trước khi cắt lấy ngày. `created_at::date` cắt theo
 * UTC, nên mọi đơn lập từ 0h đến 7h sáng giờ VN bị lùi một ngày — và đơn lập
 * đầu tháng thì nhảy sang tháng trước, tức sai điểm KPI của cả hai tháng.
 *
 * Chạy TRƯỚC khi dựng chỉ mục để khỏi phải cập nhật chỉ mục cho từng dòng.
 */
UPDATE "insurance_orders"
SET "order_date" = ("created_at" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;--> statement-breakpoint
CREATE INDEX "insurance_orders_dept_date" ON "insurance_orders" USING btree (created_by_department_id, order_date desc, id);--> statement-breakpoint
CREATE INDEX "insurance_orders_creator_date" ON "insurance_orders" USING btree (created_by, order_date desc, id);--> statement-breakpoint
CREATE INDEX "insurance_orders_date" ON "insurance_orders" USING btree (order_date desc, id);