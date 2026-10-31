-- Phiếu thông tin ngân hàng theo tháng (chốt 2026-10-31), cùng kiến trúc phôi bảo hiểm 0154:
-- văn phòng cấp cho phòng, Trưởng phòng và Phó phòng chia cho nhân viên. Loại phiếu là ngân hàng.
--
-- Dùng lại hai hành động `allocate-blanks` và `split-blanks` của 0154 trên module `banking`, nên
-- không thêm giá trị enum. Quyền cho tài khoản có sẵn cấp bằng `db:grant-bank-blanks`, chạy SAU migrate.
CREATE TABLE IF NOT EXISTS "bank_blank_department_quotas" (
	"year_month" text NOT NULL,
	"department_id" uuid NOT NULL REFERENCES "departments"("id"),
	"bank_id" uuid NOT NULL REFERENCES "banks"("id"),
	"quantity" integer NOT NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_blank_department_quotas_pk" PRIMARY KEY ("year_month", "department_id", "bank_id"),
	CONSTRAINT "bank_blank_department_quotas_quantity" CHECK ("quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_blank_staff_quotas" (
	"year_month" text NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"bank_id" uuid NOT NULL REFERENCES "banks"("id"),
	"department_id" uuid NOT NULL REFERENCES "departments"("id"),
	"issued" integer NOT NULL,
	"used" integer,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_blank_staff_quotas_pk" PRIMARY KEY ("year_month", "user_id", "bank_id"),
	CONSTRAINT "bank_blank_staff_quotas_issued" CHECK ("issued" >= 0),
	CONSTRAINT "bank_blank_staff_quotas_used" CHECK ("used" IS NULL OR "used" >= 0),
	CONSTRAINT "bank_blank_staff_quotas_not_empty" CHECK ("issued" > 0 OR "used" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_blank_staff_quotas_department" ON "bank_blank_staff_quotas" ("department_id", "year_month");
