-- Sổ lượt huỷ đơn bảo hiểm theo NGƯỜI LẬP đơn (chốt 2026-09-19).
--
-- Tháng 9/2026 có 623 lượt huỷ trên 28 nghìn đơn; 260 lượt vì nhân viên để
-- ngày bắt đầu mặc định là ngày lập đơn trong khi khách còn bảo hiểm cũ. Form
-- tạo đơn sẽ bắt người huỷ nhiều xác nhận lại với khách trước khi nhập ngày.
--
-- Mỗi dòng là một lượt đơn sang `cancelled`, KHÔNG phân loại lý do: lý do huỷ
-- ở `insurance_order_status_history.note` là chữ gõ tay, máy không đọc được.
-- Đếm mọi lượt huỷ trong tháng lịch, đủ ngưỡng thì áp.
--
-- Bảng SỰ KIỆN chứ không phải cột đếm: một dòng là một việc đã xảy ra, không
-- phải cập nhật khi thứ khác đổi, nên không cần `db:recount`. Đếm theo
-- `(user_id, cancelled_on)` có chỉ mục, mỗi người vài dòng một tháng.
CREATE TABLE "insurance_cancel_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  -- Người LẬP đơn, không phải người bấm huỷ: lỗi thuộc về người nhập.
  "user_id" uuid NOT NULL,
  -- Ngày huỷ theo giờ Việt Nam, kiểu `date` để so tháng thẳng trên chỉ mục.
  -- Cùng lối `insurance_orders.order_date`: máy chủ chạy UTC nên không dùng
  -- `current_date`.
  "cancelled_on" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Đơn xoá thì lượt huỷ của nó mất theo. App không có đường xoá đơn đã huỷ.
ALTER TABLE "insurance_cancel_events" ADD CONSTRAINT "insurance_cancel_events_order_id_insurance_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."insurance_orders"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "insurance_cancel_events" ADD CONSTRAINT "insurance_cancel_events_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Form tạo đơn đếm "người này huỷ mấy đơn từ ngày 1 tháng này".
CREATE INDEX "insurance_cancel_events_user_month" ON "insurance_cancel_events" ("user_id", "cancelled_on");
--> statement-breakpoint

-- Lấp từ lịch sử trạng thái để tháng 9/2026 có số ngay khi lên. Bỏ dòng
-- `cancelled → cancelled`: đó là ghi chú hệ thống "PVI cấp giấy sau khi huỷ",
-- không phải một lượt huỷ. Đơn không có người lập thì không đếm cho ai.
INSERT INTO "insurance_cancel_events" ("order_id", "user_id", "cancelled_on", "created_at")
SELECT h.order_id, o.created_by,
  (h.changed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  h.changed_at
FROM insurance_order_status_history h
JOIN insurance_orders o ON o.id = h.order_id
WHERE h.to_status = 'cancelled'
  AND h.from_status IS DISTINCT FROM 'cancelled'
  AND o.created_by IS NOT NULL;
--> statement-breakpoint

-- Trigger ở DB chứ không ở tầng app, cùng lý do với `mgst_sync_account_count`
-- (migration 0005): đơn sang `cancelled` từ nhiều đường — huỷ có lý do, đặt
-- trạng thái tay, vá bằng SQL — dặn từng đường nhớ ghi thì tới ngày có một
-- đường quên. `OLD.status IS DISTINCT FROM` để lượt hệ thống ghi chú lên đơn
-- đã huỷ (cancelled → cancelled) không thành lượt huỷ thứ hai.
CREATE OR REPLACE FUNCTION mgst_log_insurance_cancel() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO insurance_cancel_events (order_id, user_id, cancelled_on)
    VALUES (NEW.id, NEW.created_by, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date);
  END IF;
  RETURN NULL;
END $fn$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS insurance_orders_log_cancel ON insurance_orders;
--> statement-breakpoint
CREATE TRIGGER insurance_orders_log_cancel
AFTER UPDATE OF status ON insurance_orders
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
EXECUTE FUNCTION mgst_log_insurance_cancel();
