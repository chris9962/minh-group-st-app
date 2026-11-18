-- Shop mua quà ShopeePay và sản phẩm của từng shop (chủ dự án chốt 2026-11-18).
-- Bước 2 của dòng ShopeePay bắt khai shop đã mua quà. Bước 2 xếp shop theo số đơn
-- trong ngày, ít đơn đứng đầu, để Shopee không thấy một shop nhận quá nhiều đơn.
CREATE TABLE "gift_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_shops_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "gift_shop_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL REFERENCES "gift_shops"("id"),
	"name" text NOT NULL,
	"price" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gift_shop_products_shop_name_unique" ON "gift_shop_products" USING btree ("shop_id", "name");
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "gift_shop_id" uuid REFERENCES "gift_shops"("id");
--> statement-breakpoint
CREATE INDEX "bank_accounts_gift_shop_finished" ON "bank_accounts" USING btree ("gift_shop_id", "finished_at") WHERE "gift_shop_id" IS NOT NULL;
