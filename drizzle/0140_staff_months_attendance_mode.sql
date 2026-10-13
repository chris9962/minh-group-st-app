-- Cách chấm công của phòng chụp theo tháng (AGENTS.md §5.3). Cột trên
-- `departments` (0139) là giá trị hiện tại. Không chụp thì admin bật hoặc tắt
-- chấm công ở tháng sau làm lượt tính lại ngày công của tháng trước chưa chốt
-- đổi nguồn: tháng đó không có lượt chấm nên ngày công bị xoá.
ALTER TABLE "staff_months" ADD COLUMN IF NOT EXISTS "attendance_mode" "attendance_mode";--> statement-breakpoint
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
     fixed_salary, attendance_mode)
  SELECT u.id, to_char(m, 'YYYY-MM'), u.department_id, u.role, u.contract_type, u.salary_scheme, u.active,
         ARRAY(SELECT md.department_id FROM user_managed_departments md WHERE md.user_id = u.id),
         u.fixed_salary, d.attendance_mode
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
       s.managed_department_ids, s.fixed_salary, s.attendance_mode
FROM staff_months s
UNION ALL
SELECT u.id, to_char(m, 'YYYY-MM'), u.department_id, u.role, u.contract_type, u.salary_scheme, u.active,
       ARRAY(SELECT md.department_id FROM user_managed_departments md WHERE md.user_id = u.id),
       u.fixed_salary, d.attendance_mode
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
