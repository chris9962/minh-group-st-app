-- Phòng được giao theo dõi đơn bảo hiểm. Trục riêng của module bảo hiểm, tách
-- khỏi `user_managed_departments` — danh sách kia nở phạm vi `managed` của mọi
-- module và bật mục Nhân sự, quá rộng cho người chỉ xem và xuất đơn bảo hiểm.
CREATE TABLE "user_insurance_departments" (
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	CONSTRAINT "user_insurance_departments_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "user_insurance_departments" ADD CONSTRAINT "user_insurance_departments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_insurance_departments" ADD CONSTRAINT "user_insurance_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
