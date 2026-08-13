-- Hai chỉ mục cho chiều sắp TĂNG DẦN của màn tài khoản ngân hàng.
--
-- `bank_accounts_opened` và `bank_accounts_dept_opened` khai
-- `opened_date DESC NULLS LAST`. Postgres đọc ngược chỉ mục đó ra
-- `ASC NULLS FIRST`, còn câu truy vấn hỏi `ASC NULLS LAST` — lệch ngay khoá
-- ĐẦU nên planner bỏ hẳn chỉ mục. Một cú bấm vào tiêu đề cột "Ngày" thành một
-- lượt quét cả bảng.
--
-- Đo trên bảng tạm 200.000 dòng cùng cấu trúc:
--   không có chỉ mục tăng: Seq Scan, 200.000 dòng, 19,7 ms
--   có chỉ mục tăng      : Index Only Scan, 15 dòng, 0,07 ms
-- Bản lọc theo phòng: 26,3 ms so với 0,06 ms.
--
-- `insurance_orders` và `services` KHÔNG cần chỉ mục tăng tương ứng. Chỉ mục
-- của chúng khai `DESC` trơn, đọc ngược ra `ASC NULLS LAST` khớp đúng khoá đầu;
-- chỉ khoá cuối `id` lệch, và Postgres chữa bằng `Incremental Sort` — đo được
-- 0,135 ms, không cần thêm chỉ mục.
--
-- Vì sao không đổi câu truy vấn cho khớp chỉ mục sẵn có: `opened_date` NULL ở
-- dòng `creating` (tài khoản đang tạo dở), và `NULLS LAST` giữ chúng luôn nằm
-- cuối ở CẢ HAI chiều. Đổi sang `NULLS FIRST` là dòng nháp nhảy lên đầu danh
-- sách khi người dùng sắp tăng dần.
CREATE INDEX "bank_accounts_opened_asc" ON "bank_accounts"
  USING btree ("opened_date" ASC NULLS LAST, "created_at" ASC, "id" ASC);--> statement-breakpoint
CREATE INDEX "bank_accounts_dept_opened_asc" ON "bank_accounts"
  USING btree ("created_by_department_id", "opened_date" ASC NULLS LAST, "created_at" ASC, "id" ASC);
