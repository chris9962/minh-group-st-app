-- Ảnh sản phẩm của shop mua quà ShopeePay (chủ dự án yêu cầu 2026-11-18). Cột giữ khoá trong kho ảnh, null = chưa có ảnh.
ALTER TABLE "gift_shop_products" ADD COLUMN "image" text;
