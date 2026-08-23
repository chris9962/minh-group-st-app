-- Phạm vi phòng cho danh sách khách hàng P-40 (chốt 2026-08-23).
--
-- Cấp quản lý mở trang Khách hàng nay chỉ thấy khách phòng mình, nên mọi câu
-- lấy một trang đều kèm `where created_by_department_id in (...)`. Không có chỉ
-- mục đúng hình dạng đó thì Postgres xếp lại toàn bộ khách khớp bộ lọc trước
-- khi cắt 15 dòng — quét cả kho để lấy một trang (AGENTS.md §5.2).
--
-- Khoá sắp mặc định của P-40 là `created_at desc, id`. Ba khoá còn lại (tên,
-- số tài khoản, số đơn) đã có chỉ mục riêng và chưa kèm phòng: chúng hiếm dùng
-- hơn, và thêm bốn chỉ mục nữa cho một bảng ghi nhiều là tốn chi phí ghi mà
-- chưa đo được lợi.
CREATE INDEX "customers_dept_date" ON "customers"
  USING btree ("created_by_department_id", "created_at" DESC, "id");
