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
-- `gift_grant_changes` trỏ `gift_grants` và KHÔNG có on delete cascade, nên phải
-- xoá trước. Bảng này sinh sau đợt dọn 2026-08-30 nên bản script cũ thiếu nó, và
-- lượt chạy 2026-09-02 dừng ở đây.
DELETE FROM gift_grant_changes;
DELETE FROM gift_grants;
DELETE FROM bank_accounts;
DELETE FROM customer_phones;
DELETE FROM customers;

DELETE FROM audit_log;

-- Bộ đếm mã đơn. Xoá dòng là đủ: `nextOrderCodes` dùng
-- `insert … on conflict do update` (src/server/insurance.ts:679), nên đơn đầu
-- tiên của kỳ tạo lại dòng và nhận mã DH-2608-001.
DELETE FROM order_code_counters;

-- Điểm KPI của nhân viên ĐÃ TẮT không tự về 0: `recomputeKpiForMonth` chỉ duyệt
-- nhân viên đang bật (src/server/kpi.ts:288). Xoá thẳng dòng điểm của họ; tài
-- khoản giữ nguyên.
--
-- Đợt 2026-08-30 chỉ có một tài khoản dạng này là `mg-nnt`, và nó đã bị xoá
-- khỏi `users` từ sau đợt đó. Câu dưới viết theo ĐIỀU KIỆN chứ không theo tên,
-- để lần chạy nào cũng đúng.
DELETE FROM kpi_scores
WHERE user_id IN (SELECT id FROM users WHERE active = false);

COMMIT;
