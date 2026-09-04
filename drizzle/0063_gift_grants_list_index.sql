-- Chỉ mục cho màn Quà đã phát P-44 (AGENTS.md §5.2).
--
-- Bảng chỉ có `gift_grants_customer_id_unique`, dựng cho việc tra một khách.
-- Màn danh sách hỏi câu khác hẳn: lọc theo người phát và khoảng ngày, sắp theo
-- ngày phát, rồi cắt 15 dòng. Thiếu chỉ mục đúng hình dạng đó thì Postgres phải
-- xếp lại toàn bộ kết quả khớp bộ lọc trước khi cắt trang.
--
-- `id` là khoá phá hoà: nhiều đợt phát cùng một mốc giờ thì thiếu nó, thứ tự
-- giữa các trang không ổn định và một dòng hiện ở cả trang 1 lẫn trang 2.
CREATE INDEX "gift_grants_date" ON "gift_grants" ("granted_at" DESC, "id");
--> statement-breakpoint

-- Trục NGƯỜI PHÁT, đối xứng với chỉ mục trên. Phạm vi bản ghi đổi thành danh
-- sách người trước khi lọc (`departmentUserIds` ở `server/gift.ts`), nên cả bộ
-- lọc phòng lẫn bộ lọc nhân viên đều đi qua cột này.
CREATE INDEX "gift_grants_granter_date" ON "gift_grants" ("granted_by", "granted_at" DESC, "id");
