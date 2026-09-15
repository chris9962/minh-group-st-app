-- Nhật ký khách ghi thêm lượt DỜI NGÀY HỒ SƠ (chốt 2026-09-16). Ngày hồ sơ là
-- mốc của điểm KPI, rổ quà và kỳ luật từ chốt đó, nên dời nó phải để lại dấu.
-- Cùng lối 0080: chỉ thêm giá trị enum, không dùng trong cùng lượt migrate.
ALTER TYPE customer_change_field ADD VALUE 'created_day';
