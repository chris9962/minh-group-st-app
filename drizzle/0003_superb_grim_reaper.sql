CREATE TABLE "insurance_package_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"ord" smallint NOT NULL,
	"product" "insurance_product" NOT NULL,
	"years" smallint NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "insurance_package_legs_years_positive" CHECK ("insurance_package_legs"."years" > 0),
	CONSTRAINT "insurance_package_legs_fee_non_negative" CHECK ("insurance_package_legs"."fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "insurance_packages" DROP CONSTRAINT "insurance_packages_fee_non_negative";--> statement-breakpoint
ALTER TABLE "insurance_package_legs" ADD CONSTRAINT "insurance_package_legs_package_id_insurance_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."insurance_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_package_legs_ord" ON "insurance_package_legs" USING btree ("package_id","ord");--> statement-breakpoint
ALTER TABLE "insurance_packages" DROP COLUMN "yearly_fee";--> statement-breakpoint
-- Backfill: 7 gói đang có trong DB chưa có leg nào, mà seed thì bị chặn vì bảng
-- `insurance_packages` đã có dòng. Không backfill thì hộp thoại tạo đơn hiện 0
-- form cho mọi gói. Khai theo đúng bảng ở mgst-db-design.md §2.
INSERT INTO "insurance_package_legs" ("package_id", "ord", "product", "years", "fee")
SELECT p.id, v.ord, v.product::"insurance_product", v.years, v.fee
FROM "insurance_packages" p
JOIN (VALUES
  ('BH-1N-XEMAY',     1, 'motorbike',         1, 100000),
  ('BH-2N-XEMAY',     1, 'motorbike',         2, 200000),
  ('BH-3N-XEMAY',     1, 'motorbike',         3, 300000),
  ('BH-1N-DIEN',      1, 'electric-accident', 1, 100000),
  ('BH-1N-DIEN-200K', 1, 'electric-accident', 1, 200000),
  -- Hãng chỉ phát hành hợp đồng tai nạn điện 1 năm → gói 2 năm là HAI leg.
  ('BH-2N-DIEN-100K', 1, 'electric-accident', 1, 100000),
  ('BH-2N-DIEN-100K', 2, 'electric-accident', 1, 100000),
  -- Gói ghép chỉ khác gói trên ở `product` của từng leg.
  ('BH-COMBO-1N',     1, 'motorbike',         1, 100000),
  ('BH-COMBO-1N',     2, 'electric-accident', 1, 100000)
) AS v(code, ord, product, years, fee) ON v.code = p.code
ON CONFLICT DO NOTHING;
