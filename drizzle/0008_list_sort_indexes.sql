CREATE INDEX "bank_accounts_dept_opened" ON "bank_accounts" USING btree (created_by_department_id, opened_date desc nulls last, id);--> statement-breakpoint
CREATE INDEX "bank_accounts_opened" ON "bank_accounts" USING btree (opened_date desc nulls last, id);--> statement-breakpoint
CREATE INDEX "services_date" ON "services" USING btree (service_date desc, id);--> statement-breakpoint
CREATE INDEX "services_ward" ON "services" USING btree ("ward_id");