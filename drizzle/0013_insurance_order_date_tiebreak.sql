DROP INDEX "insurance_orders_dept_date";--> statement-breakpoint
DROP INDEX "insurance_orders_creator_date";--> statement-breakpoint
DROP INDEX "insurance_orders_date";--> statement-breakpoint
CREATE INDEX "insurance_orders_dept_date" ON "insurance_orders" USING btree (created_by_department_id, order_date desc, created_at desc, id);--> statement-breakpoint
CREATE INDEX "insurance_orders_creator_date" ON "insurance_orders" USING btree (created_by, order_date desc, created_at desc, id);--> statement-breakpoint
CREATE INDEX "insurance_orders_date" ON "insurance_orders" USING btree (order_date desc, created_at desc, id);