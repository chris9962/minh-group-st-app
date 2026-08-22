-- Cột `departments.type` — loại phòng quyết định công thức tính điểm KPI
-- (spec §7.0, chốt 2026-08-22).
--
-- Hai loại: `sales` cho 11 phòng bán hàng, `office` cho 4 phòng còn lại.
-- Công thức ở spec §7.1 · §7.2 chỉ áp cho `sales`. `office` CHƯA CÓ công thức,
-- nên người của các phòng đó không có dòng trong `kpi_scores` — khác với "đã
-- chấm và được 0 điểm".
--
-- `sales` gồm KD-1…KD-9, cộng `PHONG-Y` và `PHONG-DU-AN`: hai phòng này cũng
-- phục vụ khách, Phòng Y lập hồ sơ khách kênh Bệnh viện còn Phòng Dự Án ghi
-- dịch vụ. Bốn phòng `office` là An Sinh, Kế toán tổng hợp, Kinh doanh tổng hợp
-- và Bảo trợ xã hội. `PHONG-KDTH` đứng ở nhóm `office` dù tên có chữ kinh
-- doanh — nó giữ kho mã và kho ngân hàng, không mở tài khoản cho khách.
--
-- Mặc định là `office`: phòng lập mới ở P-91 chưa có ô chọn loại, mà cấp nhầm
-- công thức cho phòng không kinh doanh thì không ai thấy.
--
-- Lượt gán dưới đây đọc mã phòng CHỈ MỘT LẦN, cho 15 phòng đang có. Sau lượt
-- này mã phòng không còn quyết định gì — loại nằm ở cột riêng, đúng hướng A của
-- spec §7.0.
CREATE TYPE "department_type" AS ENUM('sales', 'office');
ALTER TABLE "departments" ADD COLUMN "type" "department_type" DEFAULT 'office' NOT NULL;
UPDATE "departments" SET "type" = 'sales'
  WHERE "code" LIKE 'KD-%' OR "code" IN ('PHONG-Y', 'PHONG-DU-AN');
