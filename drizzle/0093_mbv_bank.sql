-- Ngân hàng MBV (B9) vào thể lệ từ kỳ 2026-09-16, nhóm Bank hạn chế. Luật điểm
-- và quà trỏ bằng MÃ `MBV` (`src/rules/2026-09-16.ts`), nên mã phải cố định:
-- thêm bằng migration chứ không qua P-71. `scripts/seed-data.ts` cũng có dòng
-- này, nhưng seed chỉ chạy lúc dựng database mới.
--
-- `manual` vì chưa rõ MBV có lấy số điện thoại làm số tài khoản không; sửa ở
-- P-71 khi biết. Chạy lại không chèn đôi: kiểm mã trước khi chèn.
INSERT INTO "banks" ("code", "required_photos", "account_number_method", "coefficient", "counts_as_app")
SELECT 'MBV', 3, 'manual', 1, true
WHERE NOT EXISTS (SELECT 1 FROM "banks" WHERE "code" = 'MBV');
