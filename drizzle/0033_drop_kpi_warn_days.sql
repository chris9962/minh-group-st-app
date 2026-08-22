-- Bỏ cột `kpi_targets.warn_days_left` — không có cảnh báo nào đọc nó.
--
-- Cột này định giữ mốc "còn bấy nhiêu ngày cuối tháng thì nhắc người chưa đạt"
-- (spec §4.8 P-83, để mở). Phần nhắc chưa bao giờ được viết: `daysLeft` ở P-51,
-- P-52 và màn Tổng quan chỉ in "còn N ngày", không so với mốc này. Con số đi
-- một vòng từ ô nhập xuống database rồi đọc ngược lại chính ô đó.
ALTER TABLE "kpi_targets" DROP COLUMN "warn_days_left";
