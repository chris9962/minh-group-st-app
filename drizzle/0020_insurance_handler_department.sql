-- Snapshot phòng của NGƯỜI NHẬN XỬ LÝ đơn, chụp lúc họ bấm "Nhận đơn xử lý".
--
-- Một đơn bảo hiểm có hai người liên quan: người tạo và người xử lý tay. Luật
-- nhìn thấy đơn cho phép cấp quản lý của CẢ HAI phòng đó xem — mà `handled_by`
-- chỉ trỏ tới người, không nói họ thuộc phòng nào lúc nhận việc.
--
-- Tra động `users.department_id` thì người xử lý luân chuyển phòng là quản lý
-- phòng cũ mất quyền xem đơn họ từng phụ trách, còn quản lý phòng mới bỗng thấy
-- đơn phòng mình chưa từng đụng. Cùng lý do với `created_by_department_id`
-- (quyết định #8).
ALTER TABLE "insurance_orders" ADD COLUMN "handled_by_department_id" uuid;--> statement-breakpoint
-- Backfill TRƯỚC khi gắn ràng buộc. Đơn đã có người nhận thì lấy phòng hiện tại
-- của họ — ước lượng tốt nhất còn lại cho phòng lúc nhận việc.
UPDATE "insurance_orders" AS o
   SET "handled_by_department_id" = u."department_id"
  FROM "users" AS u
 WHERE u."id" = o."handled_by";--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_handled_by_department_id_departments_id_fk" FOREIGN KEY ("handled_by_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Luật nhìn thấy đơn lọc theo cả hai trục, nên trục người xử lý cũng cần chỉ mục
-- đối xứng với `insurance_orders_dept_date`.
CREATE INDEX "insurance_orders_handler_dept_date" ON "insurance_orders" USING btree ("handled_by_department_id","order_date" DESC,"created_at" DESC,"id");--> statement-breakpoint
CREATE INDEX "insurance_orders_handler_date" ON "insurance_orders" USING btree ("handled_by","order_date" DESC,"created_at" DESC,"id");
