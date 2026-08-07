ALTER TABLE "customers" ADD COLUMN "gift_case" text;--> statement-breakpoint
CREATE INDEX "customers_gift_case" ON "customers" USING btree ("gift_case") WHERE gift_case is not null;