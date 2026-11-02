-- Phiếu thông tin ngân hàng theo cùng luật chuyển phòng của phôi bảo hiểm ở 0160
-- (chủ dự án chốt 2026-11-02). Khác phôi ở cách đếm: phiếu tính ĐÚNG MỘT LẦN khi
-- tài khoản sang Hoàn thành; Lỗi hay Đã sửa lỗi sau đó không đổi số, chỉ xoá dòng
-- mới trả phiếu lại. `bank_accounts.blank_department_id` ghi phòng đã tính phiếu:
-- có giá trị là đã tính, và xoá tài khoản mà người lập đã sang phòng khác thì
-- trigger từ chối, vì phiếu đó là lịch sử của phòng cũ.
ALTER TABLE "bank_blank_staff_quotas" DROP CONSTRAINT IF EXISTS "bank_blank_staff_quotas_pk";--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" ADD CONSTRAINT "bank_blank_staff_quotas_pk" PRIMARY KEY ("year_month", "user_id", "bank_id", "department_id");--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "used_orders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "returned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" DROP CONSTRAINT IF EXISTS "bank_blank_staff_quotas_returned";--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" ADD CONSTRAINT "bank_blank_staff_quotas_returned" CHECK ("returned" >= 0);--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" DROP CONSTRAINT IF EXISTS "bank_blank_staff_quotas_not_empty";--> statement-breakpoint
ALTER TABLE "bank_blank_staff_quotas" ADD CONSTRAINT "bank_blank_staff_quotas_not_empty" CHECK ("issued" > 0 OR "used" IS NOT NULL OR "used_orders" <> 0 OR "returned" <> 0 OR "closed_at" IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_blank_staff_quotas_open" ON "bank_blank_staff_quotas" ("year_month", "user_id", "bank_id") WHERE "closed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "blank_department_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "bank_accounts_blank_department_id_departments_id_fk";--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_blank_department_id_departments_id_fk" FOREIGN KEY ("blank_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Tháng của phiếu là tháng HỒ SƠ KHÁCH theo giờ Việt Nam, cùng mốc với điểm KPI
-- (`customerDay.ts`). Khác `mgst_bump_insurance_blank`: tài khoản mang sẵn phòng đã
-- tính phiếu (`blank_department_id`), nên cộng trừ vào đúng dòng của phòng đó, kể cả
-- dòng đã khoá. Nhờ vậy `db:recount-blanks` so được mọi dòng với tài khoản.
CREATE OR REPLACE FUNCTION mgst_bump_bank_blank(p_user uuid, p_customer uuid, p_bank uuid, p_department uuid, p_delta integer) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_month text;
BEGIN
  IF p_user IS NULL OR p_department IS NULL THEN RETURN; END IF;
  SELECT to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') INTO v_month FROM customers WHERE id = p_customer;
  IF v_month IS NULL THEN RETURN; END IF;
  DELETE FROM bank_blank_staff_quotas
    WHERE year_month = v_month AND user_id = p_user AND bank_id = p_bank AND department_id = p_department
      AND closed_at IS NULL AND issued = 0 AND used IS NULL AND returned = 0 AND used_orders + p_delta = 0;
  IF FOUND THEN RETURN; END IF;
  INSERT INTO bank_blank_staff_quotas (year_month, user_id, bank_id, department_id, issued, used_orders)
    VALUES (v_month, p_user, p_bank, p_department, 0, p_delta)
    ON CONFLICT (year_month, user_id, bank_id, department_id) DO UPDATE
      SET used_orders = bank_blank_staff_quotas.used_orders + p_delta, updated_at = now();
END $fn$;--> statement-breakpoint

-- BEFORE chứ không AFTER: trigger phải ghi được `NEW.blank_department_id` và chặn
-- được lượt xoá. Tài khoản đã tính phiếu mà đổi người lập (đổi chủ hồ sơ sang
-- đồng nghiệp) thì phiếu đi theo tài khoản sang người mới, tính ở phòng hiện tại
-- của người mới. Đổi khách hay đổi ngân hàng thì giữ phòng đã tính.
CREATE OR REPLACE FUNCTION mgst_count_bank_blank() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.blank_department_id IS NOT NULL THEN
      IF (SELECT department_id FROM users WHERE id = OLD.created_by) IS DISTINCT FROM OLD.blank_department_id THEN
        RAISE EXCEPTION 'Phiếu của tài khoản này đã tính cho phòng cũ của người lập, không xoá được.';
      END IF;
      PERFORM mgst_bump_bank_blank(OLD.created_by, OLD.customer_id, OLD.bank_id, OLD.blank_department_id, -1);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.blank_department_id IS NOT NULL
     AND (NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.customer_id <> OLD.customer_id OR NEW.bank_id <> OLD.bank_id) THEN
    PERFORM mgst_bump_bank_blank(OLD.created_by, OLD.customer_id, OLD.bank_id, OLD.blank_department_id, -1);
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      SELECT department_id INTO NEW.blank_department_id FROM users WHERE id = NEW.created_by;
    END IF;
    PERFORM mgst_bump_bank_blank(NEW.created_by, NEW.customer_id, NEW.bank_id, NEW.blank_department_id, 1);
    RETURN NEW;
  END IF;
  IF NEW.status = 'done' AND NEW.blank_department_id IS NULL AND NEW.created_by IS NOT NULL THEN
    SELECT department_id INTO NEW.blank_department_id FROM users WHERE id = NEW.created_by;
    PERFORM mgst_bump_bank_blank(NEW.created_by, NEW.customer_id, NEW.bank_id, NEW.blank_department_id, 1);
  END IF;
  RETURN NEW;
END $fn$;--> statement-breakpoint

DROP TRIGGER IF EXISTS bank_accounts_count_blank ON bank_accounts;--> statement-breakpoint
CREATE TRIGGER bank_accounts_count_blank
BEFORE INSERT OR DELETE OR UPDATE OF status, created_by, customer_id, bank_id ON bank_accounts
FOR EACH ROW EXECUTE FUNCTION mgst_count_bank_blank();
