-- Xoá dữ liệu khách trước buổi tập huấn.
-- Kế hoạch đầy đủ: docs/plan-clean-tap-huan-2026-08-30.md, bước 4 và bước 5.
--
-- Chạy:
--   docker exec -i mgst-db psql -U mgst -d mgst -v ON_ERROR_STOP=1 \
--     < /opt/mgst-app/scripts/db-clean-training.sql
--
-- ⚠️ Xuất danh sách khoá ảnh (bước 3) TRƯỚC khi chạy file này. Xoá xong thì
-- không còn chỗ nào tra ra khoá ảnh trên S3.
--
-- DELETE chứ không TRUNCATE: trigger `mgst_sync_referral_counts` chạy theo từng
-- dòng, và nó là thứ đưa `referral_codes.used_count` với `holding_count` về 0.
-- TRUNCATE bỏ qua trigger theo dòng, các mã sẽ báo hết chỗ dù không còn tài
-- khoản nào.
BEGIN;

-- Thứ tự theo chiều khoá ngoại. Nhóm này không có on delete cascade, trừ
-- `bank_account_photos` chết theo `bank_accounts`.
DELETE FROM insurance_order_status_history;
DELETE FROM insurance_orders;
DELETE FROM services;
DELETE FROM gift_grants;
DELETE FROM bank_accounts;
DELETE FROM customer_phones;
DELETE FROM customers;

DELETE FROM audit_log;

-- Bộ đếm mã đơn. Xoá dòng là đủ: `nextOrderCodes` dùng
-- `insert … on conflict do update` (src/server/insurance.ts:679), nên đơn đầu
-- tiên của kỳ tạo lại dòng và nhận mã DH-2608-001.
DELETE FROM order_code_counters;

-- Tài khoản `mg-nnt` đã tắt nhưng còn 1.00 điểm dịch vụ, sinh từ một dòng
-- `services` vừa xoá ở trên. `recomputeKpiForMonth` chỉ duyệt nhân viên đang
-- bật (src/server/kpi.ts:288) nên bước tính lại KPI không chạm tới dòng này.
-- Chỉ xoá dòng điểm, tài khoản giữ nguyên.
DELETE FROM kpi_scores
WHERE user_id = (SELECT id FROM users WHERE username = 'mg-nnt')
  AND year_month = '2026-08';

COMMIT;
