-- Tick sẵn "đã cài app" ở bước 2 theo từng ngân hàng (chốt 2026-09-06).
--
-- Trước đây bước 2 ghi cứng `appInstalled: true`, nên ngân hàng nào cũng tick
-- sẵn. Chủ dự án chốt đảo lại: mặc định KHÔNG tick, ngân hàng nào cần tick sẵn
-- thì người quản ngân hàng bật riêng ở P-60.
--
-- KHÁC `counts_as_app`: cột này chỉ quyết định giá trị mặc định của ô tick,
-- không đụng luật đếm app xét quà.
ALTER TABLE "banks"
  ADD COLUMN IF NOT EXISTS "app_default" boolean DEFAULT false NOT NULL;
