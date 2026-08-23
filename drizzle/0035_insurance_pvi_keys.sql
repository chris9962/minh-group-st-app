-- Hai khoá định danh đơn BÊN PVI, thu về từ bot.
--
-- `pvi_electronic_order_no` là cột "Số đơn ĐT" ở màn `/Service/Manager`, dạng
-- `26/21/14/TNCN/0096592`. Nó chỉ hiện ở BẢNG đó — màn duyệt không hiện, nên
-- bot phải đọc lúc còn ở bảng.
--
-- `pvi_pr_key` là khoá PVI dùng trong mọi đường dẫn thao tác trên đơn:
-- `/Service/Assign/?pr_key=...&tthai=DUYET`. Lưu dạng THÔ (`W6fXX4Fd7+I=`),
-- không lưu bản đã url-encode — mã hoá lại lúc dựng địa chỉ.
--
-- Cả hai để rỗng chứ không `null`: đơn tạo trước bot không có giá trị nào để
-- backfill, và chuỗi rỗng đọc ra "chưa thu được", cùng lối với
-- `beneficiary_id_number`.
--
-- KHÔNG đặt unique. Bot khớp đơn PVI về đơn của mình bằng tên khách cộng loại
-- bảo hiểm, mà một khách mua hai đơn liền kề năm thì hai đơn giống nhau mọi
-- thông tin hiện trên màn duyệt. Bot chọn một trong hai và có thể ghi trùng
-- khoá — xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`. Ràng buộc unique ở
-- đây làm luồng duyệt dừng giữa chừng vì một sai sót đã chấp nhận.
ALTER TABLE "insurance_orders" ADD COLUMN "pvi_electronic_order_no" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD COLUMN "pvi_pr_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Luồng duyệt tra đơn theo tên người thụ hưởng + sản phẩm, lọc đơn chờ duyệt.
CREATE INDEX "insurance_orders_pending_match" ON "insurance_orders" USING btree ("status","product","beneficiary_name");
