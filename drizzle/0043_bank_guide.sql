-- Hướng dẫn mở tài khoản theo từng ngân hàng (chốt 2026-08-24).
--
-- Mỗi ngân hàng có quy trình riêng: VPb bắt nhập mã giới thiệu ở bước định
-- danh, ngân hàng khác lại đòi hai giao dịch sau khi mở. Đội kinh doanh đang
-- phải hỏi nhau hoặc nhớ, mà nhớ sai là tài khoản không được duyệt.
--
-- `guide` là chữ tự do nhiều dòng — người nhập tự đánh số bước và tự ghi chú
-- ảnh ("Ảnh 1: lúc nhập mã"). KHÔNG tách thành bảng bước riêng: nội dung mỗi
-- ngân hàng một khác, và mọi cấu trúc dựng ra đều chật với ngân hàng thứ hai.
ALTER TABLE "banks" ADD COLUMN "guide" text;
--> statement-breakpoint

-- Ảnh mẫu đi kèm hướng dẫn.
--
-- Bảng riêng chứ không phải cột mảng: ảnh có THỨ TỰ, và thứ tự đó phải khớp với
-- phần "Ảnh 1 · Ảnh 2 …" người nhập viết trong `guide`.
--
-- `cascade` vì ảnh mẫu không có nghĩa gì khi ngân hàng biến mất — cùng lối
-- `bank_account_photos`, chỗ cascade duy nhất còn lại của schema.
CREATE TABLE "bank_guide_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bank_id" uuid NOT NULL REFERENCES "banks"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bank_guide_photos_bank" ON "bank_guide_photos" ("bank_id");
