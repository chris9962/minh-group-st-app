-- Chấm công nhân viên Điểm ATM (chốt 2026-10-02). Mỗi ngày 4 lượt, mỗi lượt một
-- ảnh chụp tại chỗ, tọa độ GPS và giờ máy chủ. Chỉ để theo dõi: không đụng ngày
-- công, không đụng lương.
--
-- Quyền xem: module `attendance`, chỉ hành động `view-detail`. Người chấm công là
-- người có `users.salary_scheme = 'atm'`, không đi qua quyền.
--
-- ADD VALUE chạy được trong transaction vì file này không dùng giá trị mới.
ALTER TYPE "module_key" ADD VALUE IF NOT EXISTS 'attendance' BEFORE 'system';--> statement-breakpoint
CREATE TYPE "attendance_slot" AS ENUM ('morning-in', 'noon-out', 'afternoon-in', 'afternoon-out');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "department_id" uuid REFERENCES "departments"("id"),
  "work_date" date NOT NULL,
  "slot" "attendance_slot" NOT NULL,
  "checked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "photo_url" text NOT NULL,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "accuracy" double precision NOT NULL,
  "place" text,
  CONSTRAINT "attendance_checks_latitude" CHECK ("latitude" BETWEEN -90 AND 90),
  CONSTRAINT "attendance_checks_longitude" CHECK ("longitude" BETWEEN -180 AND 180),
  CONSTRAINT "attendance_checks_accuracy" CHECK ("accuracy" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_checks_user_day_slot" ON "attendance_checks" ("user_id", "work_date", "slot");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_checks_dept_day" ON "attendance_checks" ("department_id", "work_date");
