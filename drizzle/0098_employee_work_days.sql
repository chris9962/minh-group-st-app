-- Một dòng cho mỗi ngày nhân viên có ít nhất một khách mang tài khoản hoàn
-- thành. Đây là dữ liệu tổng hợp có thể dựng lại từ customers + bank_accounts;
-- bảng lương đọc nó thay vì quét kho nghiệp vụ mỗi lần mở màn.
CREATE TABLE "employee_work_days" (
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"department_id" uuid NOT NULL,
	"qualifying_customer_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_work_days_user_id_work_date_pk" PRIMARY KEY("user_id","work_date"),
	CONSTRAINT "employee_work_days_customer_count_positive" CHECK ("employee_work_days"."qualifying_customer_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "employee_work_days" ADD CONSTRAINT "employee_work_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "employee_work_days" ADD CONSTRAINT "employee_work_days_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "employee_work_days_department_date" ON "employee_work_days" USING btree ("department_id","work_date");
--> statement-breakpoint
INSERT INTO "employee_work_days" ("user_id", "work_date", "department_id", "qualifying_customer_count")
SELECT
	c."created_by",
	(c."created_at" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
	u."department_id",
	count(DISTINCT c."id")::integer
FROM "customers" c
INNER JOIN "users" u ON u."id" = c."created_by"
INNER JOIN "bank_accounts" a ON a."customer_id" = c."id" AND a."status" = 'done'
WHERE u."role" = 'staff' AND u."department_id" IS NOT NULL
GROUP BY c."created_by", (c."created_at" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, u."department_id";
