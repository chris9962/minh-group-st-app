-- Bộ lọc Ấp của màn Khách hàng P-40 (AGENTS.md §5.2).
--
-- Ô lọc gửi lên chính chuỗi `Ấp, Xã, Tỉnh` mà `customers.address` đang lưu, nên
-- vế so là `=`. Không có chỉ mục thì mỗi lượt lọc là một lượt quét cả bảng khách
-- rồi xếp lại theo ngày tạo để lấy 15 dòng.
--
-- `created_at desc, id` đi kèm vì đó là khoá sắp mặc định của màn — cùng hình
-- dạng với `customers_dept_date`.
CREATE INDEX "customers_address_date" ON "customers" ("address", "created_at" DESC, "id");
