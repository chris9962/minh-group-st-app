-- Kho quà (chốt thử 2026-10-24): mỗi lần hàng về, quản lý nhập một dòng. Số còn lại của một món
-- bằng tổng các dòng nhập trừ số đã phát kể từ dòng nhập đầu tiên. Món chưa có dòng nào thì không
-- giới hạn.
CREATE TABLE IF NOT EXISTS "gift_stock_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_item_id" uuid NOT NULL REFERENCES "gift_items"("id"),
	"quantity" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_stock_entries_quantity_positive" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_stock_entries_item_date" ON "gift_stock_entries" ("gift_item_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_stock_entries_date" ON "gift_stock_entries" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_grants_item_date" ON "gift_grants" ("chosen_item", "granted_at");
