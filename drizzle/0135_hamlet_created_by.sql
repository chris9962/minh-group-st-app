-- Người tạo ấp, hiện ở bảng ấp của Danh mục xã / ấp (chốt 2026-10-12).
--
-- Ấp có sẵn lấy người tạo từ dòng "Thêm ấp" trong `audit_log`. Dòng đó ghi
-- `target_id` là id TỈNH, không phải id ấp, nên ghép theo tỉnh + thời điểm: route
-- ghi nhật ký ngay sau khi chèn ấp, chậm nhất vài chục mili giây. Nhiều dòng
-- trong khung 5 giây thì ưu tiên dòng mang đúng tên ấp. Ấp không có dòng nhật
-- ký thì để NULL, giao diện hiện "—".
ALTER TABLE "hamlets" ADD COLUMN IF NOT EXISTS "created_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
UPDATE "hamlets" h
SET "created_by" = a."actor_id"
FROM (
  SELECT DISTINCT ON (h2."id") h2."id" AS "hamlet_id", al."actor_id"
  FROM "hamlets" h2
  JOIN "wards" w ON w."id" = h2."ward_id"
  JOIN "audit_log" al
    ON al."target_table" = 'hamlets'
   AND al."action" = 'create'
   AND al."target_id" = w."province_id"::text
   AND al."at" BETWEEN h2."created_at" AND h2."created_at" + interval '5 seconds'
  ORDER BY h2."id", starts_with(al."target_label", 'Thêm ấp ' || h2."name" || ' (') DESC, al."at"
) a
WHERE a."hamlet_id" = h."id" AND h."created_by" IS NULL;
