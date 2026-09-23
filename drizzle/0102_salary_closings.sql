-- Chốt lương theo tháng. Tháng có dòng trong `salary_closings` thì mọi màn đọc
-- lương từ `salary_snapshots`, không tính lại từ điểm và ngày công.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm. Drizzle bọc cả loạt
-- migration vào MỘT transaction, mà Postgres cấm dùng giá trị enum trong cùng
-- transaction với `ALTER TYPE … ADD VALUE` (cùng lối 0100). Phần cấp
-- `*:close-salary` cho tài khoản toàn quyền nằm ở script `db:grant-close-salary`,
-- chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'close-salary';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_closings" (
	"year_month" text PRIMARY KEY NOT NULL,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_closings_year_month" CHECK ("salary_closings"."year_month" ~ '^\d{4}-(0[1-9]|1[0-2])$')
);--> statement-breakpoint
ALTER TABLE "salary_closings" ADD CONSTRAINT "salary_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salary_snapshots" (
	"year_month" text NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	CONSTRAINT "salary_snapshots_year_month_user_id_pk" PRIMARY KEY("year_month","user_id")
);--> statement-breakpoint
ALTER TABLE "salary_snapshots" ADD CONSTRAINT "salary_snapshots_year_month_salary_closings_year_month_fk" FOREIGN KEY ("year_month") REFERENCES "public"."salary_closings"("year_month") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_snapshots" ADD CONSTRAINT "salary_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
