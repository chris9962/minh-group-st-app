-- Số ấn chỉ điện tử PVI trả về ở callback mục 13, trường `SerialNumber`
-- (chốt 2026-08-27). Ví dụ `260473932`.
--
-- KHÁC `pvi_electronic_order_no` là SỐ ĐƠN dạng `26/21/14/MOTO/0109539` — trên
-- màn PVI hai số này nằm cạnh nhau, "Số đơn điện tử" và "Số ấn chỉ".
ALTER TABLE "insurance_orders"
  ADD COLUMN "pvi_serial_number" text NOT NULL DEFAULT '';
