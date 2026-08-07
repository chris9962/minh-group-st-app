-- Phá hoà thứ tự trong CÙNG một ngày bằng `created_at`.
--
-- `opened_date` và `service_date` là kiểu `date`, không có giờ, nên mọi dòng
-- cùng ngày đều hoà. Khoá phá hoà cũ là `id` — uuid ngẫu nhiên — nên trong một
-- ngày thứ tự đọc ra như xáo bài, và người vừa nhập xong không thấy dòng của
-- mình đâu. Đơn bảo hiểm đã chữa đúng cách này ở migration 0013.
--
-- Index phải dựng lại theo: `ORDER BY` mới không khớp index cũ thì Postgres bỏ
-- Index Scan, chuyển sang Sort — mà Sort không chảy được, nó phải nuốt trọn đầu
-- vào rồi mới nhả dòng đầu tiên, tức phân trang trả giá ở MỌI trang.
DROP INDEX "bank_accounts_dept_opened";--> statement-breakpoint
DROP INDEX "bank_accounts_opened";--> statement-breakpoint
CREATE INDEX "bank_accounts_dept_opened" ON "bank_accounts" USING btree (created_by_department_id, opened_date desc nulls last, created_at desc, id);--> statement-breakpoint
CREATE INDEX "bank_accounts_opened" ON "bank_accounts" USING btree (opened_date desc nulls last, created_at desc, id);--> statement-breakpoint
DROP INDEX "services_date";--> statement-breakpoint
CREATE INDEX "services_date" ON "services" USING btree (service_date desc, created_at desc, id);
