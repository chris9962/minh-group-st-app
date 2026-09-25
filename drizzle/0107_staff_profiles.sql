-- Hồ sơ HR của nhân viên, nhập từ file hồ sơ nhân viên của phòng Kế toán
-- (chốt 2026-09-25: nhập sẵn để dùng sau). Migration không chèn dòng nào; chạy
-- `bun run db:import-contract-types -- --apply` để nhập. Bảng có CCCD, mã số
-- thuế, số tài khoản ngân hàng: chưa route nào đọc.
CREATE TABLE IF NOT EXISTS "staff_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"gender" text,
	"birth_date" date,
	"contract_number" text,
	"contract_term" text,
	"contract_kind" text,
	"contract_start" date,
	"contract_end" date,
	"request_date" date,
	"job_position" text,
	"work_unit" text,
	"tax_code" text,
	"id_number" text,
	"id_issued_on" date,
	"id_issued_by" text,
	"address" text,
	"bank_account_number" text,
	"bank_name" text,
	"bank_branch" text,
	"nationality" text,
	"email" text,
	"employment_status" text,
	"note" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
