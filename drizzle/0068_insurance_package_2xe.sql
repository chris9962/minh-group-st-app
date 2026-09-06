-- Gói "2 năm BH xe máy cho 2 xe": hai đơn xe máy 1 năm, hai xe khác nhau, cùng
-- bắt đầu một ngày (chủ dự án chốt 2026-09-06). Cùng mức quà với gói 2 năm xe
-- máy một xe, nên mã cố định `BH-2N-XEMAY-2XE` được luật quà kỳ 2026-09 trỏ tới.
--
-- Thêm bằng migration chứ không thêm ở P-82: màn đó sinh mã từ tên, còn luật quà
-- trỏ bằng MÃ nên mã phải biết trước. `scripts/seed-data.ts` cũng có gói này,
-- nhưng seed chỉ chạy một lần lúc dựng database mới; database đang chạy thì đi
-- đường này. Chạy lại không chèn đôi: kiểm mã trước khi chèn.
INSERT INTO "insurance_packages" ("code", "name", "active")
SELECT 'BH-2N-XEMAY-2XE', '2 năm BH xe máy cho 2 xe', true
WHERE NOT EXISTS (SELECT 1 FROM "insurance_packages" WHERE "code" = 'BH-2N-XEMAY-2XE');
--> statement-breakpoint

INSERT INTO "insurance_package_legs" ("package_id", "ord", "product", "years", "fee")
SELECT p."id", v."ord", 'motorbike', 1, 76000
FROM "insurance_packages" p
CROSS JOIN (VALUES (1), (2)) AS v("ord")
WHERE p."code" = 'BH-2N-XEMAY-2XE'
  AND NOT EXISTS (
    SELECT 1 FROM "insurance_package_legs" l WHERE l."package_id" = p."id" AND l."ord" = v."ord"
  );
