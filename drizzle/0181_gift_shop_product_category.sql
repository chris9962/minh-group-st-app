-- Loại quà của sản phẩm shop ShopeePay, để modal chọn quà lọc theo loại (chủ dự án yêu cầu 2026-11-18). Giá trị là khoá trong `GIFT_CATEGORY_LABEL`.
ALTER TABLE "gift_shop_products" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;
