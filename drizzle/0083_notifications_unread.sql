-- Chỉ mục cho câu ĐẾM CHƯA ĐỌC của chuông trên thanh trên.
--
-- Chỉ mục sẵn có `notifications_user` sắp theo `(user_id, created_at desc)`,
-- phục vụ câu lấy danh sách. Câu đếm lại lọc `read_at is null`, và với người
-- đã đọc hết thì Postgres vẫn phải quét mọi dòng cũ của họ để biết là 0.
--
-- Chỉ mục MỘT PHẦN nên nó chỉ chứa dòng chưa đọc. Đọc xong là dòng rơi khỏi
-- chỉ mục, nên nó luôn nhỏ dù bảng lớn thêm mỗi ngày.
CREATE INDEX "notifications_unread" ON "notifications" USING btree ("user_id") WHERE "read_at" IS NULL;
