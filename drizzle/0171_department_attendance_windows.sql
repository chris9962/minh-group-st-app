ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "morning_in_until" time;
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "noon_out_from" time;
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "afternoon_in_until" time;
ALTER TABLE "departments" ADD COLUMN IF NOT EXISTS "afternoon_out_from" time;
