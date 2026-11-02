-- Phôi bảo hiểm khi chuyển phòng (chủ dự án chốt 2026-11-02): phôi đã sử dụng ở
-- lại phòng cũ, phôi chưa sử dụng về phòng cũ. Mỗi (tháng, người, loại, phòng)
-- một dòng, nên khoá chính thêm `department_id`. Lúc chuyển phòng app khoá dòng
-- ở phòng cũ (`closed_at`) và ghi `returned`; dòng khoá là lịch sử.
--
-- `used_orders` là CỘT ĐẾM DO TRIGGER GIỮ, cùng lối `customers.account_count`
-- (migration 0005): đơn sang `done` thì +1, rời `done` thì -1, vào dòng ĐANG MỞ của
-- người đó trong tháng của `order_date`. Bản trước đếm lại đơn mỗi lần đọc, nên màn
-- chậm dần theo tháng và không chia được đơn theo lúc chuyển phòng. Trả đủ giá
-- của cột đếm theo mgst-db-design §9: `UPDATE OF` liệt kê đủ cột công thức phụ
-- thuộc, và `bun run db:recount-blanks` đếm lại được.
ALTER TABLE "insurance_blank_staff_quotas" DROP CONSTRAINT IF EXISTS "insurance_blank_staff_quotas_pk";--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" ADD CONSTRAINT "insurance_blank_staff_quotas_pk" PRIMARY KEY ("year_month", "user_id", "blank_type_id", "department_id");--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "used_orders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "returned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" DROP CONSTRAINT IF EXISTS "insurance_blank_staff_quotas_returned";--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" ADD CONSTRAINT "insurance_blank_staff_quotas_returned" CHECK ("returned" >= 0);--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" DROP CONSTRAINT IF EXISTS "insurance_blank_staff_quotas_not_empty";--> statement-breakpoint
ALTER TABLE "insurance_blank_staff_quotas" ADD CONSTRAINT "insurance_blank_staff_quotas_not_empty" CHECK ("issued" > 0 OR "used" IS NOT NULL OR "used_orders" <> 0 OR "returned" <> 0 OR "closed_at" IS NOT NULL);--> statement-breakpoint
-- Mỗi người, mỗi tháng, mỗi loại phôi chỉ một dòng đang mở: trigger cộng trừ vào đúng dòng đó.
CREATE UNIQUE INDEX IF NOT EXISTS "insurance_blank_staff_quotas_open" ON "insurance_blank_staff_quotas" ("year_month", "user_id", "blank_type_id") WHERE "closed_at" IS NULL;--> statement-breakpoint

-- Cộng `p_delta` vào dòng đang mở của người đó. Chưa có dòng thì tạo ở phòng hiện
-- tại của người đó; người không thuộc phòng nào (Giám đốc, cố vấn) thì không đếm.
-- Dòng chỉ do trigger tạo mà về 0 thì xoá, vì ràng buộc `not_empty` không nhận dòng
-- trống. Loại phôi chọn như `typeOfOrder` ở `insuranceBlanks.ts`: cùng sản phẩm, số
-- tiền bảo hiểm khớp hoặc loại không kén số tiền, lấy loại đứng trước theo `sort`.
CREATE OR REPLACE FUNCTION mgst_bump_insurance_blank(p_user uuid, p_month text, p_product insurance_product, p_sum integer, p_delta integer) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_type uuid;
  v_department uuid;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  SELECT id INTO v_type FROM insurance_blank_types
    WHERE active AND product = p_product AND (sum_insured IS NULL OR sum_insured = p_sum)
    ORDER BY sort, code LIMIT 1;
  IF v_type IS NULL THEN RETURN; END IF;
  DELETE FROM insurance_blank_staff_quotas
    WHERE year_month = p_month AND user_id = p_user AND blank_type_id = v_type AND closed_at IS NULL
      AND issued = 0 AND used IS NULL AND returned = 0 AND used_orders + p_delta = 0;
  IF FOUND THEN RETURN; END IF;
  UPDATE insurance_blank_staff_quotas SET used_orders = used_orders + p_delta, updated_at = now()
    WHERE year_month = p_month AND user_id = p_user AND blank_type_id = v_type AND closed_at IS NULL;
  IF FOUND THEN RETURN; END IF;
  SELECT department_id INTO v_department FROM users WHERE id = p_user;
  IF v_department IS NULL THEN RETURN; END IF;
  INSERT INTO insurance_blank_staff_quotas (year_month, user_id, blank_type_id, department_id, issued, used_orders)
    VALUES (p_month, p_user, v_type, v_department, 0, p_delta)
    ON CONFLICT (year_month, user_id, blank_type_id, department_id) DO UPDATE
      SET used_orders = insurance_blank_staff_quotas.used_orders + p_delta, updated_at = now();
END $fn$;--> statement-breakpoint

-- Hai nhánh rời nhau như `mgst_sync_account_count`: đơn đổi người lập, đổi số
-- tiền bảo hiểm hay đổi ngày thì trừ dòng cũ và cộng dòng mới.
CREATE OR REPLACE FUNCTION mgst_count_insurance_blank() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_moved boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_moved := NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.product <> OLD.product
      OR NEW.sum_insured IS DISTINCT FROM OLD.sum_insured
      OR NEW.order_date <> OLD.order_date;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.status = 'done' AND (TG_OP = 'DELETE' OR NEW.status <> 'done' OR v_moved) THEN
    PERFORM mgst_bump_insurance_blank(OLD.created_by, to_char(OLD.order_date, 'YYYY-MM'), OLD.product, OLD.sum_insured, -1);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status <> 'done' OR v_moved) THEN
    PERFORM mgst_bump_insurance_blank(NEW.created_by, to_char(NEW.order_date, 'YYYY-MM'), NEW.product, NEW.sum_insured, 1);
  END IF;
  RETURN NULL;
END $fn$;--> statement-breakpoint

DROP TRIGGER IF EXISTS insurance_orders_count_blank ON insurance_orders;--> statement-breakpoint
CREATE TRIGGER insurance_orders_count_blank
AFTER INSERT OR DELETE OR UPDATE OF status, created_by, product, sum_insured, order_date ON insurance_orders
FOR EACH ROW EXECUTE FUNCTION mgst_count_insurance_blank();
