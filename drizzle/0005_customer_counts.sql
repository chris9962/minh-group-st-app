ALTER TABLE "customers" ADD COLUMN "account_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "insurance_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "customers_account_count" ON "customers" USING btree (account_count desc, search_name);--> statement-breakpoint
CREATE INDEX "customers_insurance_count" ON "customers" USING btree (insurance_count desc, search_name);--> statement-breakpoint
-- Đếm lại cho dữ liệu đã có, TRƯỚC khi gắn trigger.
UPDATE "customers" c SET "account_count" = coalesce(a.n, 0)
FROM (SELECT customer_id, count(*)::int n FROM bank_accounts WHERE status = 'done' GROUP BY customer_id) a
WHERE a.customer_id = c.id;--> statement-breakpoint
UPDATE "customers" c SET "insurance_count" = coalesce(a.n, 0)
FROM (SELECT customer_id, count(*)::int n FROM insurance_orders GROUP BY customer_id) a
WHERE a.customer_id = c.id;--> statement-breakpoint

-- Trigger giữ hai cột đếm. Drizzle-kit không quản function/trigger nên phần này
-- viết tay, cùng cách `mgst_normalize` ở migration 0000.
--
-- Đặt ở DB chứ không ở tầng app là có chủ đích: tài khoản ngân hàng được ghi từ
-- nhiều đường (tạo, hoàn thành, xoá bản nháp, nhập hàng loạt, vá tay), dặn từng
-- đường nhớ cộng trừ thì tới ngày có một đường quên — và số lệch kiểu đó không
-- báo lỗi, chỉ âm thầm sai.
CREATE OR REPLACE FUNCTION mgst_sync_account_count() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- Chỉ tài khoản `done` mới tính. Bản nháp `creating` là lượt giữ chỗ mã
  -- (spec §4.5), chưa phải tài khoản — nên chuyển creating→done cũng là +1.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' THEN
      UPDATE customers SET account_count = account_count + 1 WHERE id = NEW.customer_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'done' THEN
      UPDATE customers SET account_count = account_count - 1 WHERE id = OLD.customer_id;
    END IF;
  ELSE
    -- Hai nhánh rời nhau, không phải if/else: đổi khách VÀ đổi trạng thái cùng
    -- lúc thì phải trừ bên cũ và cộng bên mới, gộp lại là mất một vế.
    IF OLD.status = 'done' AND (NEW.status <> 'done' OR NEW.customer_id <> OLD.customer_id) THEN
      UPDATE customers SET account_count = account_count - 1 WHERE id = OLD.customer_id;
    END IF;
    IF NEW.status = 'done' AND (OLD.status <> 'done' OR NEW.customer_id <> OLD.customer_id) THEN
      UPDATE customers SET account_count = account_count + 1 WHERE id = NEW.customer_id;
    END IF;
  END IF;
  RETURN NULL;
END $fn$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION mgst_sync_insurance_count() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE customers SET insurance_count = insurance_count + 1 WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE customers SET insurance_count = insurance_count - 1 WHERE id = OLD.customer_id;
  ELSIF NEW.customer_id <> OLD.customer_id THEN
    UPDATE customers SET insurance_count = insurance_count - 1 WHERE id = OLD.customer_id;
    UPDATE customers SET insurance_count = insurance_count + 1 WHERE id = NEW.customer_id;
  END IF;
  RETURN NULL;
END $fn$;--> statement-breakpoint

DROP TRIGGER IF EXISTS bank_accounts_sync_count ON bank_accounts;--> statement-breakpoint
CREATE TRIGGER bank_accounts_sync_count
AFTER INSERT OR DELETE OR UPDATE OF status, customer_id ON bank_accounts
FOR EACH ROW EXECUTE FUNCTION mgst_sync_account_count();--> statement-breakpoint

DROP TRIGGER IF EXISTS insurance_orders_sync_count ON insurance_orders;--> statement-breakpoint
CREATE TRIGGER insurance_orders_sync_count
AFTER INSERT OR DELETE OR UPDATE OF customer_id ON insurance_orders
FOR EACH ROW EXECUTE FUNCTION mgst_sync_insurance_count();
