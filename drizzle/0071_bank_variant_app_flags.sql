-- "Có đi kèm app" và "tick sẵn đã cài app" đi theo LOẠI tài khoản, không theo
-- ngân hàng (chốt 2026-09-07): CNKD/HKD của cùng một ngân hàng có luật khác
-- bản Thường. Bản Thường vẫn đọc hai cột trên `banks`; CNKD/HKD đọc ở đây.
--
-- Mặc định false cho cả hai: spec §2.6 chốt CNKD/HKD không đi kèm app.
ALTER TABLE "bank_guide_variants"
  ADD COLUMN IF NOT EXISTS "counts_as_app" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "app_default" boolean DEFAULT false NOT NULL;
