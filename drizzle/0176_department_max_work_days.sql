-- Trần ngày công của phòng có chấm công, admin đặt ở P-91 (chủ dự án chốt
-- 2026-11-16): tháng 31 ngày tối đa 27, tháng dưới 31 ngày tối đa 26. Phòng
-- không chấm công không đọc hai cột này, giữ trần theo cách tính lương.
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "max_work_days_31" smallint DEFAULT 27 NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "max_work_days_under_31" smallint DEFAULT 26 NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_max_work_days_31_range" CHECK ("max_work_days_31" BETWEEN 1 AND 31);--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_max_work_days_under_31_range" CHECK ("max_work_days_under_31" BETWEEN 1 AND 31);--> statement-breakpoint
-- Chụp theo tháng (AGENTS.md §5.3): admin đổi trần ở tháng sau không đổi lương tháng trước chưa chốt.
ALTER TABLE "staff_months" ADD COLUMN IF NOT EXISTS "max_work_days_31" smallint;--> statement-breakpoint
ALTER TABLE "staff_months" ADD COLUMN IF NOT EXISTS "max_work_days_under_31" smallint;--> statement-breakpoint
-- Tháng đã chụp nhận mặc định 27/26, gồm 2026-10 chưa chốt lương (chủ dự án
-- chốt 2026-11-16). Kỳ lương trước 2026-10 không đọc hai cột này.
UPDATE "staff_months" s
SET "max_work_days_31" = d."max_work_days_31", "max_work_days_under_31" = d."max_work_days_under_31"
FROM "departments" d
WHERE d.id = s.department_id;--> statement-breakpoint
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
     fixed_salary, attendance_mode, max_work_days_31, max_work_days_under_31)
  SELECT u.id, to_char(m, 'YYYY-MM'), u.department_id, u.role, u.contract_type, u.salary_scheme, u.active,
         ARRAY(SELECT md.department_id FROM user_managed_departments md WHERE md.user_id = u.id),
         u.fixed_salary, d.attendance_mode, d.max_work_days_31, d.max_work_days_under_31
  FROM users u
  LEFT JOIN departments d ON d.id = u.department_id
  CROSS JOIN generate_series(last_month + interval '1 month', current_month - interval '1 month', interval '1 month') m
  -- Người tạo sau tháng đó không thuộc tháng đó.
  WHERE u.created_at < ((m + interval '1 month') AT TIME ZONE 'Asia/Ho_Chi_Minh')
  ON CONFLICT DO NOTHING;
END $$;
--> statement-breakpoint
-- Cột mới đứng cuối: CREATE OR REPLACE VIEW chỉ cho thêm cột ở cuối.
CREATE OR REPLACE VIEW "staff_roster" AS
SELECT s.user_id, s.year_month, s.department_id, s.role, s.contract_type, s.salary_scheme, s.active,
       s.managed_department_ids, s.fixed_salary, s.attendance_mode, s.max_work_days_31, s.max_work_days_under_31
FROM staff_months s
UNION ALL
SELECT u.id, to_char(m, 'YYYY-MM'), u.department_id, u.role, u.contract_type, u.salary_scheme, u.active,
       ARRAY(SELECT md.department_id FROM user_managed_departments md WHERE md.user_id = u.id),
       u.fixed_salary, d.attendance_mode, d.max_work_days_31, d.max_work_days_under_31
FROM users u
LEFT JOIN departments d ON d.id = u.department_id
CROSS JOIN generate_series(
  coalesce(
    (SELECT to_date(max(year_month), 'YYYY-MM') + interval '1 month' FROM staff_months),
    timestamp '2026-07-01'
  ),
  date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),
  interval '1 month'
) m
WHERE u.created_at < ((m + interval '1 month') AT TIME ZONE 'Asia/Ho_Chi_Minh');
