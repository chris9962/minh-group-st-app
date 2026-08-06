ALTER TABLE "referral_codes" ADD COLUMN "used_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD COLUMN "holding_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_counts_non_negative" CHECK (used_count >= 0 and holding_count >= 0);--> statement-breakpoint

-- Đếm lại cho dữ liệu đã có, TRƯỚC khi gắn trigger. Mã chưa có tài khoản nào
-- không khớp dòng nào ở đây và giữ mặc định 0.
UPDATE "referral_codes" r
SET "used_count" = a.done, "holding_count" = a.creating
FROM (
  SELECT referral_code_id,
         count(*) FILTER (WHERE status = 'done')::int AS done,
         count(*) FILTER (WHERE status = 'creating')::int AS creating
  FROM bank_accounts
  GROUP BY referral_code_id
) a
WHERE a.referral_code_id = r.id;--> statement-breakpoint

-- Trigger giữ hai cột đếm. Drizzle-kit không quản function/trigger nên phần này
-- viết tay, cùng cách `mgst_sync_account_count` ở migration 0005.
--
-- Đặt ở DB chứ không ở tầng app là có chủ đích: một tài khoản ngân hàng đi qua
-- nhiều đường ghi (mở, hoàn thành, xoá bản nháp, đổi mã, nhập hàng loạt, vá
-- tay), dặn từng đường nhớ cộng trừ thì tới ngày có một đường quên — và số lệch
-- kiểu đó không báo lỗi, chỉ âm thầm làm mã đã đầy vẫn hiện "còn chỗ".
CREATE OR REPLACE FUNCTION mgst_sync_referral_counts() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- Mỗi tài khoản luôn nằm ĐÚNG một ô: `creating` là lượt giữ chỗ (spec §4.5),
  -- `done` là chỗ đã tiêu. Enum chỉ có hai giá trị nên chuyển trạng thái là
  -- chuyển ô — trừ bên này, cộng bên kia, tổng không đổi.
  IF TG_OP = 'INSERT' THEN
    UPDATE referral_codes
       SET used_count = used_count + (NEW.status = 'done')::int,
           holding_count = holding_count + (NEW.status = 'creating')::int
     WHERE id = NEW.referral_code_id;

  -- Huỷ một tài khoản = XOÁ dòng `creating` (§10 chỉ cho xoá khi đang tạo dở),
  -- nên nhánh này là đường nhả chỗ về kho.
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE referral_codes
       SET used_count = used_count - (OLD.status = 'done')::int,
           holding_count = holding_count - (OLD.status = 'creating')::int
     WHERE id = OLD.referral_code_id;

  -- Hai lệnh rời nhau, không phải if/else: đổi mã VÀ đổi trạng thái cùng lúc
  -- thì phải trừ bên mã cũ và cộng bên mã mới, gộp lại là mất một vế.
  ELSIF OLD.status <> NEW.status OR OLD.referral_code_id <> NEW.referral_code_id THEN
    UPDATE referral_codes
       SET used_count = used_count - (OLD.status = 'done')::int,
           holding_count = holding_count - (OLD.status = 'creating')::int
     WHERE id = OLD.referral_code_id;
    UPDATE referral_codes
       SET used_count = used_count + (NEW.status = 'done')::int,
           holding_count = holding_count + (NEW.status = 'creating')::int
     WHERE id = NEW.referral_code_id;
  END IF;
  RETURN NULL;
END $fn$;--> statement-breakpoint

-- `UPDATE OF` phải liệt kê CẢ `referral_code_id`: thiếu nó thì đổi mã của một
-- tài khoản không bắn trigger, hai mã lệch số vĩnh viễn mà không ai thấy.
DROP TRIGGER IF EXISTS bank_accounts_sync_referral_counts ON bank_accounts;--> statement-breakpoint
CREATE TRIGGER bank_accounts_sync_referral_counts
AFTER INSERT OR DELETE OR UPDATE OF status, referral_code_id ON bank_accounts
FOR EACH ROW EXECUTE FUNCTION mgst_sync_referral_counts();
