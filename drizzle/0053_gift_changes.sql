-- Lịch sử đổi quà. Mỗi dòng giữ món cũ/mới, lý do và người thực hiện;
-- `gift_grants.chosen_item` vẫn là món đang áp dụng để KPI đọc một nguồn.
CREATE TABLE "gift_grant_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gift_grant_id" uuid NOT NULL,
  "from_chosen_item" text NOT NULL,
  "to_chosen_item" text NOT NULL,
  "reason" text NOT NULL,
  "changed_by" uuid NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gift_grant_changes"
  ADD CONSTRAINT "gift_grant_changes_gift_grant_id_gift_grants_id_fk"
  FOREIGN KEY ("gift_grant_id") REFERENCES "public"."gift_grants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gift_grant_changes"
  ADD CONSTRAINT "gift_grant_changes_changed_by_users_id_users_id_fk"
  FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "gift_grant_changes_grant_time" ON "gift_grant_changes" USING btree ("gift_grant_id", "changed_at");
--> statement-breakpoint
-- Các đơn quà lịch sử được tạo trước khi luồng ghi `gift_grant_id`; một khách
-- chỉ có một lượt quà nên ghép theo khách là xác định. Đơn tự mua không chạm.
UPDATE "insurance_orders" o
SET "gift_grant_id" = g."id"
FROM "gift_grants" g
WHERE o."source" = 'gift'
  AND o."gift_grant_id" IS NULL
  AND o."customer_id" = g."customer_id";
