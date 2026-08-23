-- Trạng thái thứ bảy: đơn đã duyệt xong bên PVI, đang đợi PVI sinh file giấy
-- chứng nhận.
--
-- Nhánh bot đi: queued → creating → pending-approval → awaiting-certificate → done.
-- `awaiting-certificate` khác `pending-approval` ở chỗ việc còn lại KHÔNG phải
-- thao tác trên PVI nữa — chỉ còn đợi file xuất hiện.
--
-- PVI không sinh file ngay lúc duyệt. Đo 2026-08-23: duyệt xong 11 phút mà
-- `/Service/DownloadFile` vẫn trả trang HTML "File trên hệ thống đã bị xóa".
-- Vì vậy luồng 3 phải quét đi quét lại chứ không tải một lần rồi thôi.
ALTER TYPE "insurance_order_status" ADD VALUE 'awaiting-certificate' BEFORE 'done';--> statement-breakpoint

-- Hai cột giữ nhịp thử lại. Thiếu chúng thì đơn nào PVI không bao giờ sinh file
-- sẽ nằm lại ở `awaiting-certificate` mãi mà không ai biết nó đã thử bao nhiêu lần.
ALTER TABLE "insurance_orders" ADD COLUMN "certificate_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD COLUMN "certificate_checked_at" timestamptz;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_certificate_attempts_non_negative" CHECK (certificate_attempts >= 0);
--> statement-breakpoint
-- Luồng 3 quét đơn đang đợi file, cũ nhất trước. `nulls first` để đơn chưa thử
-- lần nào đứng đầu hàng.
CREATE INDEX "insurance_orders_awaiting_certificate" ON "insurance_orders"
  USING btree ("status","certificate_checked_at" NULLS FIRST);
