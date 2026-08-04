CREATE INDEX "bank_accounts_creator_date" ON "bank_accounts" USING btree ("created_by","opened_date");--> statement-breakpoint
CREATE INDEX "hamlets_ward" ON "hamlets" USING btree ("ward_id");--> statement-breakpoint
CREATE INDEX "insurance_orders_creator_date" ON "insurance_orders" USING btree ("created_by","start_date");--> statement-breakpoint
CREATE INDEX "services_creator_date" ON "services" USING btree ("created_by","service_date");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "wards_province" ON "wards" USING btree ("province_id");--> statement-breakpoint
ALTER TABLE "banks" ADD CONSTRAINT "banks_required_photos_non_negative" CHECK ("banks"."required_photos" >= 0);--> statement-breakpoint
ALTER TABLE "insurance_packages" ADD CONSTRAINT "insurance_packages_fee_non_negative" CHECK ("insurance_packages"."yearly_fee" >= 0);