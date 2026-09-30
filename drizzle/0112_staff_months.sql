-- Nhân sự theo tháng (chốt với chủ dự án 2026-09-30).
--
-- Xem lại tháng đã qua phải ra đúng nhân sự của tháng đó: ai thuộc phòng nào,
-- chức vụ gì, loại hợp đồng, cách tính lương, phòng phụ trách, đang làm hay đã
-- nghỉ. Trước migration này mọi số theo tháng đọc hồ sơ HIỆN TẠI, nên chuyển
-- phòng hay thêm người trong tháng 10 làm đổi số tháng 9.
--
-- `staff_months`: bản chụp của các tháng ĐÃ QUA, mỗi người mỗi tháng một dòng.
-- `staff_roster`: view cho mọi câu hỏi theo tháng. Tháng đã chụp đọc bản chụp;
--   tháng chưa chụp, gồm tháng đang chạy, đọc hồ sơ hiện tại.
-- `ensure_staff_months()`: chụp các tháng đã kết thúc mà chưa có bản chụp, theo
--   hồ sơ lúc gọi. Job `mgst-staff-snapshot.timer` gọi hàm này lúc 00:00 ngày 1
--   hằng tháng, giờ Việt Nam (`scripts/snapshot-staff-months.ts`).
--
-- Thay đổi giữa tháng: cả tháng tính theo trạng thái cuối tháng.
CREATE TABLE IF NOT EXISTS "staff_months" (
  -- CASCADE: các script dọn tài khoản (người đã nghỉ, dữ liệu demo, e2e) xoá
  -- `users`; không có nó thì lệnh xoá vướng khoá ngoại ngay khi đã có bản chụp.
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "year_month" text NOT NULL,
  "department_id" uuid REFERENCES "departments"("id"),
  "role" "role_key" NOT NULL,
  "contract_type" "contract_type",
  "salary_scheme" "salary_scheme" NOT NULL,
  "active" boolean NOT NULL,
  "managed_department_ids" uuid[] NOT NULL DEFAULT '{}',
  CONSTRAINT "staff_months_pk" PRIMARY KEY ("user_id", "year_month"),
  CONSTRAINT "staff_months_year_month_format" CHECK ("year_month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_months_month_department" ON "staff_months" ("year_month", "department_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ensure_staff_months() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  current_month timestamp := date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh');
  last_month timestamp;
BEGIN
  -- Bảng rỗng thì chụp từ 2026-07, tháng đầu tiên có công thức lương.
  SELECT coalesce(to_date(max(year_month), 'YYYY-MM'), date '2026-06-01') INTO last_month FROM staff_months;
  IF last_month >= current_month - interval '1 month' THEN
    RETURN;
  END IF;

  INSERT INTO staff_months
    (user_id, year_month, department_id, role, contract_type, salary_scheme, active, managed_department_ids)
  SELECT u.id, to_char(m, 'YYYY-MM'), u.department_id, u.role, u.contract_type, u.salary_scheme, u.active,
         ARRAY(SELECT md.department_id FROM user_managed_departments md WHERE md.user_id = u.id)
  FROM users u
  CROSS JOIN generate_series(last_month + interval '1 month', current_month - interval '1 month', interval '1 month') m
  -- Người tạo sau tháng đó không thuộc tháng đó.
  WHERE u.created_at < ((m + interval '1 month') AT TIME ZONE 'Asia/Ho_Chi_Minh')
  ON CONFLICT DO NOTHING;
END $$;
--> statement-breakpoint
CREATE OR REPLACE VIEW "staff_roster" AS
SELECT s.user_id, s.year_month, s.department_id, s.role, s.contract_type, s.salary_scheme, s.active,
       s.managed_department_ids
FROM staff_months s
UNION ALL
SELECT u.id, to_char(m, 'YYYY-MM'), u.department_id, u.role, u.contract_type, u.salary_scheme, u.active,
       ARRAY(SELECT md.department_id FROM user_managed_departments md WHERE md.user_id = u.id)
FROM users u
CROSS JOIN generate_series(
  coalesce(
    (SELECT to_date(max(year_month), 'YYYY-MM') + interval '1 month' FROM staff_months),
    timestamp '2026-07-01'
  ),
  date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),
  interval '1 month'
) m
WHERE u.created_at < ((m + interval '1 month') AT TIME ZONE 'Asia/Ho_Chi_Minh');
--> statement-breakpoint
-- Chụp các tháng đã qua theo hồ sơ lúc chạy migration.
SELECT ensure_staff_months();
