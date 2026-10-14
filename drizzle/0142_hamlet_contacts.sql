-- Một ấp có nhiều người liên hệ (chủ dự án chốt 2026-10-14): trưởng ấp, phó ấp,
-- công an viên... Mỗi dòng một người, thứ tự theo `sort_order`.
--
-- TODO(liên hệ ấp, lượt deploy sau bản này): hai cột `hamlets.leader_name`,
-- `hamlets.leader_phone` CỐ Ý giữ lại. `deploy/deploy.sh` tự lùi về bản cũ khi
-- kiểm tra không đạt, mà bản cũ còn đọc hai cột đó. Bỏ bằng migration riêng khi
-- bản này đã chạy ổn.
CREATE TABLE IF NOT EXISTS "hamlet_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hamlet_id" uuid NOT NULL REFERENCES "hamlets"("id") ON DELETE cascade,
	"title" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hamlet_contacts_hamlet" ON "hamlet_contacts" ("hamlet_id", "sort_order");
--> statement-breakpoint
-- Chuyển trưởng ấp đang có sang dòng liên hệ đầu tiên. `NOT EXISTS` để chạy lại
-- không chép trùng.
INSERT INTO "hamlet_contacts" ("hamlet_id", "title", "name", "phone", "sort_order")
SELECT h."id", 'Trưởng ấp', h."leader_name", h."leader_phone", 0
FROM "hamlets" h
WHERE (h."leader_name" <> '' OR h."leader_phone" <> '')
  AND NOT EXISTS (SELECT 1 FROM "hamlet_contacts" c WHERE c."hamlet_id" = h."id");
