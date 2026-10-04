-- Hai cách tính lương mới (spec docs/spec-bhyt-bhxh-an-sinh.md mục 5, chốt
-- 2026-10-04): `social` cho nhân viên Phòng An Sinh, `fixed` cho người lương
-- cứng như Trưởng phòng, Phó phòng An Sinh.
--
-- ADD VALUE chạy được trong transaction vì file này không dùng giá trị mới.
-- Vì vậy luật "lương cứng phải có số tiền" nằm ở app (`StaffForm`), không là
-- CHECK ở đây.
ALTER TYPE "salary_scheme" ADD VALUE IF NOT EXISTS 'social';--> statement-breakpoint
ALTER TYPE "salary_scheme" ADD VALUE IF NOT EXISTS 'fixed';--> statement-breakpoint
-- Số tiền lương cứng mỗi tháng, đồng. Chỉ có ý nghĩa khi `salary_scheme = 'fixed'`.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fixed_salary" integer;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_fixed_salary_positive";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_fixed_salary_positive" CHECK ("fixed_salary" IS NULL OR "fixed_salary" > 0);--> statement-breakpoint
-- Chụp theo tháng như các thuộc tính nhân sự khác (AGENTS.md §5.3): sửa số tiền
-- ở tháng sau thì lương tháng trước giữ số cũ.
ALTER TABLE "staff_months" ADD COLUMN IF NOT EXISTS "fixed_salary" integer;--> statement-breakpoint
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
    (user_id, year_month, department_id, role, contract_type, salary_scheme, active, managed_department_ids,
     fixed_salary)
  SELECT u.id, to_char(m, 'YYYY-MM'), u.department_id, u.role, u.contract_type, u.salary_scheme, u.active,
         ARRAY(SELECT md.department_id FROM user_managed_departments md WHERE md.user_id = u.id),
         u.fixed_salary
  FROM users u
  CROSS JOIN generate_series(last_month + interval '1 month', current_month - interval '1 month', interval '1 month') m
  -- Người tạo sau tháng đó không thuộc tháng đó.
  WHERE u.created_at < ((m + interval '1 month') AT TIME ZONE 'Asia/Ho_Chi_Minh')
  ON CONFLICT DO NOTHING;
END $$;
--> statement-breakpoint
-- Cột mới đứng cuối: CREATE OR REPLACE VIEW chỉ cho thêm cột ở cuối.
CREATE OR REPLACE VIEW "staff_roster" AS
SELECT s.user_id, s.year_month, s.department_id, s.role, s.contract_type, s.salary_scheme, s.active,
       s.managed_department_ids, s.fixed_salary
FROM staff_months s
UNION ALL
SELECT u.id, to_char(m, 'YYYY-MM'), u.department_id, u.role, u.contract_type, u.salary_scheme, u.active,
       ARRAY(SELECT md.department_id FROM user_managed_departments md WHERE md.user_id = u.id),
       u.fixed_salary
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
