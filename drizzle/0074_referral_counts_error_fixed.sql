-- Tài khoản `error` và `fixed` vẫn chiếm chỗ của mã giới thiệu (sửa 2026-09-08).
--
-- Trigger ở migration 0007 viết khi enum `bank_account_status` chỉ có `creating`
-- và `done`. Migration 0054 thêm `error`, migration 0064 thêm `fixed`, nhưng
-- không ai sửa trigger. Hai trạng thái mới rơi ra ngoài cả hai cột đếm.
--
-- Hậu quả đo được trên máy chủ thật ngày 2026-09-08: người quản ngân hàng đánh
-- lỗi một tài khoản thì `used_count` trừ đi 1, mã hiện ra một chỗ trống không có
-- thật, nhân viên khác lấy chỗ đó. Duyệt sửa xong thì `used_count` cộng lại và
-- mã vượt trần. Mã `1888-Anh Dũng-CN Vũng Tàu` ra 54/53, mã `BD41-Khánh Tường`
-- ra 111/110.
--
-- Chỗ ở ngân hàng không nhả ra khi đánh lỗi: tài khoản vẫn tồn tại, mã vẫn tiêu
-- một suất. Nên ba trạng thái `done`, `error`, `fixed` đều tính vào `used_count`.
--
-- KHÁC với KPI: điểm chỉ tính `done`, và migration 0064 nói rõ `fixed` không
-- tính điểm. Hai phép đếm trả lời hai câu hỏi khác nhau — "ngân hàng còn cấp
-- được bao nhiêu tài khoản nữa" và "nhân viên được bao nhiêu điểm".
CREATE OR REPLACE FUNCTION mgst_sync_referral_counts() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- `creating` là lượt giữ chỗ (spec §4.5). Ba trạng thái còn lại đều là chỗ đã
  -- tiêu — kể cả tài khoản đang bị đánh lỗi, vì nó vẫn nằm ở ngân hàng.
  IF TG_OP = 'INSERT' THEN
    UPDATE referral_codes
       SET used_count = used_count + (NEW.status IN ('done', 'error', 'fixed'))::int,
           holding_count = holding_count + (NEW.status = 'creating')::int
     WHERE id = NEW.referral_code_id;

  -- Huỷ một tài khoản = XOÁ dòng `creating` (§10 chỉ cho xoá khi đang tạo dở),
  -- nên nhánh này là đường nhả chỗ về kho.
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE referral_codes
       SET used_count = used_count - (OLD.status IN ('done', 'error', 'fixed'))::int,
           holding_count = holding_count - (OLD.status = 'creating')::int
     WHERE id = OLD.referral_code_id;

  -- Hai lệnh rời nhau, không phải if/else: đổi mã VÀ đổi trạng thái cùng lúc
  -- thì phải trừ bên mã cũ và cộng bên mã mới, gộp lại là mất một vế.
  ELSIF OLD.status <> NEW.status OR OLD.referral_code_id <> NEW.referral_code_id THEN
    UPDATE referral_codes
       SET used_count = used_count - (OLD.status IN ('done', 'error', 'fixed'))::int,
           holding_count = holding_count - (OLD.status = 'creating')::int
     WHERE id = OLD.referral_code_id;
    UPDATE referral_codes
       SET used_count = used_count + (NEW.status IN ('done', 'error', 'fixed'))::int,
           holding_count = holding_count + (NEW.status = 'creating')::int
     WHERE id = NEW.referral_code_id;
  END IF;
  RETURN NULL;
END $fn$;--> statement-breakpoint

-- Đếm lại cho dữ liệu đã có. Sau lệnh này 31 mã hiện ra vượt trần: đó là con số
-- đúng, chúng đã vượt từ lúc tài khoản lỗi được duyệt lại.
UPDATE referral_codes r
SET used_count = coalesce(a.used, 0), holding_count = coalesce(a.holding, 0)
FROM (select id from referral_codes) x
LEFT JOIN (
  SELECT referral_code_id,
         count(*) FILTER (WHERE status IN ('done', 'error', 'fixed'))::int AS used,
         count(*) FILTER (WHERE status = 'creating')::int AS holding
  FROM bank_accounts
  GROUP BY referral_code_id
) a ON a.referral_code_id = x.id
WHERE r.id = x.id
  AND (r.used_count <> coalesce(a.used, 0) OR r.holding_count <> coalesce(a.holding, 0));
