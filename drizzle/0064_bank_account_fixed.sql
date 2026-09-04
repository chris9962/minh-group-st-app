-- Trạng thái "Chờ duyệt lại" cho tài khoản ngân hàng (chốt 2026-09-04).
--
-- Vòng chữa lỗi trước đây thiếu một nhịp: nhân viên sửa xong tài khoản bị đánh
-- lỗi thì không có gì nói cho người quản ngân hàng biết là đã sửa. Nay lưu xong
-- bản `error` chuyển sang `fixed`, và chỉ người quản ngân hàng đó mới đưa về
-- `done` được.
--
-- `fixed` KHÔNG tính điểm KPI, y như `error`. Mọi truy vấn KPI đã lọc
-- `status = 'done'` nên không phải sửa câu nào — điểm quay lại đúng lúc duyệt.
ALTER TYPE "bank_account_status" ADD VALUE IF NOT EXISTS 'fixed';
