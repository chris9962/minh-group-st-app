-- Điểm KPI An Sinh (spec docs/spec-bhyt-bhxh-an-sinh.md mục 3): tổng tiền thu
-- file 1 của người tải file trong tháng biên lai, chia cho mức điểm của tháng.
-- Lưu cạnh điểm ngân hàng và điểm dịch vụ; tổng điểm KPI cộng cả ba cột.
ALTER TABLE "kpi_scores" ADD COLUMN IF NOT EXISTS "social_insurance_points" numeric(10, 2) NOT NULL DEFAULT 0;
