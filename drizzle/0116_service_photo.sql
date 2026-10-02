-- Ảnh giao dịch của dịch vụ Nạp / Rút / Chuyển, không bắt buộc (chốt 2026-10-02). Cột
-- giữ KHOÁ trong kho ảnh, thư mục `services/`, cùng luật `handwritten_photo_url`.
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "photo_url" text;
