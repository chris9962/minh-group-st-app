-- Hai ô form PVI hỏi mà hệ thống chưa thu thập — bot đứng ở đúng hai ô này.
--
-- `household_size` là ô "Số thành viên gia đình tại cùng địa chỉ thường trú"
-- (`SoNguoi_HoKhau`). Đơn tai nạn điện tính theo HỘ nên nó là thông tin lõi,
-- cùng loại với `beneficiary_address`.
--
-- `sum_insured` là "Số tiền bảo hiểm" (`STBH__quytac_hienhanh`) — mức CHI TRẢ
-- khi có tai nạn, 40 hoặc 80 triệu. KHÔNG dùng lại `fee` được: `fee` là phí
-- khách trả (100 000), PVI hỏi cả hai con số ở hai ô khác nhau, và tổng phí bên
-- họ tính ra từ `sum_insured` nhân tỷ lệ phí.
--
-- Cả hai để `default 0` chứ không ràng buộc phải lớn hơn 0: đơn đã ghi trước
-- migration này không có giá trị nào để backfill đúng, mà đoán đại thì bot điền
-- số bịa vào hợp đồng thật. Ràng buộc "phải nhập" nằm ở biểu mẫu
-- (`lib/api/insuranceOrders.ts`), chỉ áp cho đơn tai nạn điện tạo từ đây về sau.
-- Đơn cũ giữ 0, và 0 là dấu hiệu rõ để bot dừng chứ không điền bừa.
ALTER TABLE "insurance_orders" ADD COLUMN "household_size" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD COLUMN "sum_insured" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_household_size_non_negative" CHECK (household_size >= 0);--> statement-breakpoint
ALTER TABLE "insurance_orders" ADD CONSTRAINT "insurance_orders_sum_insured_non_negative" CHECK (sum_insured >= 0);
