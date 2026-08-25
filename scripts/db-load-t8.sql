-- Nạp một tháng dữ liệu thật vào database DEV, từ `TÍNH ĐIỂM TỔNG T8.xlsx`.
--
-- Dùng để đo báo cáo "Tính điểm tổng" (P-73 #1) trên đúng quy mô thật: 37.744
-- khách, 102.752 tài khoản, 35.462 đơn bảo hiểm.
--
-- ⚠️ KHÔNG CHẠY TRÊN MÁY CHỦ THẬT. File mang tên và CCCD của khách hàng thật.
--
-- CÁCH CHẠY
--
--   1. Xuất CSV từ file Excel (cần openpyxl):
--        python3 scripts/db-load-t8-export.py
--   2. Đưa CSV vào container rồi chạy:
--        docker cp /tmp/t8_stage.csv mgst-db:/tmp/t8_stage.csv
--        docker cp scripts/db-load-t8.sql mgst-db:/tmp/load-t8.sql
--        docker exec mgst-db psql -U mgst -d mgst -v ON_ERROR_STOP=1 -f /tmp/load-t8.sql
--   3. Tính lại cột lưu sẵn:
--        bun run db:recount
--        bun run kpi:recompute 2026-08
--
--   Dọn: `scripts/db-clean-t8.sql`, chạy cùng cách.
--
-- Bảng `t8_stage` ở lại sau khi nạp — script dọn cần nó để tra ngược id khách.

BEGIN;

DROP TABLE IF EXISTS t8_stage;
CREATE TABLE t8_stage (
  stt int, name text, id_number text, phone text, day text, hamlet text, channel text,
  opened text, installed text, msb_stk text, household text, insurance text,
  plate text, beneficiary text, staff_code text, group_name text
);

COPY t8_stage FROM '/tmp/t8_stage.csv' WITH (FORMAT csv, HEADER true);

-- Kênh BTXH chưa có trong danh mục dev.
INSERT INTO channels (code, name, input_kind, active)
VALUES ('KENH-BTXH', 'Bảo trợ xã hội', 'free-text', true)
ON CONFLICT (code) DO NOTHING;

-- Một nhân viên cho mỗi mã CBNV trong file. `password_hash` là chuỗi rác — các
-- tài khoản này chỉ để gắn tên vào bản ghi, không dùng để đăng nhập.
INSERT INTO users (username, password_hash, full_name, phone, title, role, staff_code, department_id, active)
SELECT DISTINCT
  't8_' || lower(s.staff_code),
  'x',
  s.staff_code,
  '',
  'Nhân viên kinh doanh',
  'staff'::role_key,
  s.staff_code,
  d.id,
  true
FROM t8_stage s
LEFT JOIN departments d ON d.code = CASE
  WHEN s.group_name LIKE 'PHÒNG 1%' THEN 'KD-1'
  WHEN s.group_name LIKE 'PHÒNG 2%' THEN 'KD-2'
  WHEN s.group_name LIKE 'PHÒNG 3%' THEN 'KD-3'
  WHEN s.group_name LIKE 'PHÒNG 4%' THEN 'KD-4'
  WHEN s.group_name LIKE 'PHÒNG 5%' THEN 'KD-5'
  WHEN s.group_name LIKE 'PHÒNG 6%' THEN 'KD-6'
  WHEN s.group_name LIKE 'PHÒNG 7%' THEN 'KD-7'
  WHEN s.group_name LIKE 'PHÒNG 8%' THEN 'KD-8'
  WHEN s.group_name LIKE 'PHÒNG 9%' THEN 'KD-9'
  WHEN s.group_name LIKE 'PHÒNG Y%' THEN 'PHONG-Y'
  WHEN s.group_name LIKE 'DỰ ÁN%' THEN 'PHONG-DU-AN'
  ELSE 'PHONG-KDTH'
END
WHERE s.staff_code <> ''
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.staff_code = s.staff_code);

-- Một mã giới thiệu cho mỗi ngân hàng, sức chứa dư cho cả tháng.
INSERT INTO referral_codes (bank_id, code, total)
SELECT b.id, 'T8-' || b.code, 200000 FROM banks b
ON CONFLICT (bank_id, code) DO NOTHING;

-- Khách hàng. `channel_detail` ghép lại dạng "Tỉnh · Xã · Ấp" mà app đang dùng;
-- file chỉ có "ẤP/XÃ" nên phần tỉnh để trống.
INSERT INTO customers (id, full_name, id_number, address, channel_id, channel_detail,
                       created_by, created_by_department_id, created_at)
SELECT
  md5('t8:' || s.stt)::uuid,
  s.name,
  -- CCCD là cột UNIQUE. File có 100 số lặp hai lần, nên chỉ khách đầu tiên giữ
  -- số; khách sau để trống, đúng cách hệ thống chặn hồ sơ trùng.
  CASE WHEN s.id_number <> '' AND row_number() OVER (PARTITION BY nullif(s.id_number, '') ORDER BY s.stt) = 1
       THEN s.id_number END,
  '',
  c.id,
  CASE WHEN s.hamlet = '' THEN '' ELSE ' · ' || split_part(s.hamlet, '/', 2) || ' · ' || split_part(s.hamlet, '/', 1) END,
  u.id,
  u.department_id,
  ('2026-08-' || lpad(s.day, 2, '0'))::date
FROM t8_stage s
LEFT JOIN channels c ON c.code = CASE
  WHEN s.channel = 'KÊNH ẤP'   THEN 'KENH-AP'
  WHEN s.channel = 'ĐỊNH DANH' THEN 'KENH-DINH-DANH'
  WHEN s.channel = 'BV/TTYT'   THEN 'KENH-BENH-VIEN'
  WHEN s.channel = 'TỰ DO'     THEN 'KENH-TU-DO'
  WHEN s.channel = 'BTXH'      THEN 'KENH-BTXH'
  ELSE 'KENH-TU-DO'
END
LEFT JOIN users u ON u.staff_code = s.staff_code;

-- Số điện thoại chính.
INSERT INTO customer_phones (customer_id, number, is_primary)
SELECT md5('t8:' || s.stt)::uuid, s.phone, true
FROM t8_stage s WHERE s.phone <> '';

-- Tài khoản ngân hàng: một dòng cho mỗi mã trong cột `opened`.
INSERT INTO bank_accounts (customer_id, bank_id, referral_code_id, status, account_number,
                           opened_date, app_installed, account_type, channel_id, channel_detail,
                           created_by, created_by_department_id, finished_at, created_at)
SELECT
  md5('t8:' || s.stt)::uuid,
  b.id,
  rc.id,
  'done',
  CASE WHEN code.v LIKE 'MSB%' THEN coalesce(s.msb_stk, '') ELSE '' END,
  ('2026-08-' || lpad(s.day, 2, '0'))::date,
  coalesce(('|' || s.installed || '|') LIKE ('%|' || code.v || '|%'), false),
  CASE WHEN code.v = 'VPa' AND coalesce(s.household, '') IN ('CNKD', 'HKD') THEN s.household::bank_account_type ELSE 'none' END,
  cu.channel_id,
  cu.channel_detail,
  cu.created_by,
  cu.created_by_department_id,
  ('2026-08-' || lpad(s.day, 2, '0'))::timestamptz,
  ('2026-08-' || lpad(s.day, 2, '0'))::timestamptz
FROM t8_stage s
CROSS JOIN LATERAL unnest(string_to_array(s.opened, '|')) AS code(v)
JOIN banks b ON b.code = code.v
JOIN referral_codes rc ON rc.bank_id = b.id AND rc.code = 'T8-' || b.code
JOIN customers cu ON cu.id = md5('t8:' || s.stt)::uuid;

-- Đơn bảo hiểm cho khách có cột LOẠI BẢO HIỂM.
INSERT INTO insurance_orders (order_code, customer_id, product, package_name, fee, order_date,
                              start_date, end_date, status, source, beneficiary_name,
                              license_plate, vehicle_type, created_by, created_by_department_id, created_at)
SELECT
  'T8-' || s.stt,
  md5('t8:' || s.stt)::uuid,
  CASE WHEN s.insurance LIKE 'BHX%' THEN 'motorbike' ELSE 'electric-accident' END::insurance_product,
  CASE WHEN s.insurance LIKE 'BHX%' THEN '1 năm BH xe máy'
       WHEN s.insurance LIKE '%200%' THEN '1 năm tai nạn điện gói 200k'
       ELSE '1 năm tai nạn điện gói 100k' END,
  CASE WHEN s.insurance LIKE '%200%' THEN 200000 ELSE 100000 END,
  ('2026-08-' || lpad(s.day, 2, '0'))::date,
  ('2026-08-' || lpad(s.day, 2, '0'))::date,
  ('2027-08-' || lpad(s.day, 2, '0'))::date,
  'done',
  'gift',
  coalesce(nullif(s.beneficiary, ''), s.name),
  coalesce(nullif(s.plate, ''), '00X0-00000'),
  -- Ràng buộc `insurance_orders_motorbike_vehicle_type` đòi loại xe cho đơn xe
  -- máy; `1001` là mã xe máy dưới 50cc của PVI.
  CASE WHEN s.insurance LIKE 'BHX%' THEN '1001' ELSE '' END,
  cu.created_by,
  cu.created_by_department_id,
  ('2026-08-' || lpad(s.day, 2, '0'))::timestamptz
FROM t8_stage s
JOIN customers cu ON cu.id = md5('t8:' || s.stt)::uuid
WHERE coalesce(s.insurance, '') <> '';

COMMIT;

SELECT 'khách không có người lập' AS kiem, count(*) FROM customers WHERE created_by IS NULL;
SELECT 'mã CBNV trong file' AS kiem, count(DISTINCT staff_code) FROM t8_stage WHERE staff_code <> '';
SELECT 'nhân viên t8_' AS kiem, count(*) FROM users WHERE username LIKE 't8\_%';

SELECT 'customers' AS bang, count(*) FROM customers
UNION ALL SELECT 'bank_accounts', count(*) FROM bank_accounts
UNION ALL SELECT 'insurance_orders', count(*) FROM insurance_orders
UNION ALL SELECT 'users', count(*) FROM users;
