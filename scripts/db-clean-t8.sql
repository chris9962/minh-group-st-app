-- Dọn sạch dữ liệu nạp từ TÍNH ĐIỂM TỔNG T8.xlsx.
--
-- Nhận diện bằng `order_code`/`code` mang tiền tố T8, và khách có id sinh từ
-- `md5('t8:' || stt)` nên còn bảng staging thì tra ngược được.
BEGIN;
DELETE FROM insurance_orders WHERE order_code LIKE 'T8-%';
DELETE FROM bank_accounts WHERE referral_code_id IN (SELECT id FROM referral_codes WHERE code LIKE 'T8-%');
DELETE FROM customer_phones WHERE customer_id IN (SELECT id FROM customers WHERE id IN (SELECT md5('t8:' || stt)::uuid FROM t8_stage));
DELETE FROM kpi_scores WHERE user_id IN (SELECT id FROM users WHERE username LIKE 't8\_%');
DELETE FROM gift_grants WHERE customer_id IN (SELECT md5('t8:' || stt)::uuid FROM t8_stage);
DELETE FROM customers WHERE id IN (SELECT md5('t8:' || stt)::uuid FROM t8_stage);
DELETE FROM referral_codes WHERE code LIKE 'T8-%';
DELETE FROM users WHERE username LIKE 't8\_%';
DROP TABLE IF EXISTS t8_stage;
COMMIT;
