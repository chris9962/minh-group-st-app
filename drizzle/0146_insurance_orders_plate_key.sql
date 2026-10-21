-- Form tạo đơn bảo hiểm cảnh báo khi biển số đã có đơn xe máy chồng ngày hiệu
-- lực (chốt 2026-10-21). Biển số so sau khi bỏ mọi ký tự ngoài chữ và số rồi
-- viết hoa, vì "83P4-319.27" và "83P4-31927" là một xe. Chỉ mục đặt trên đúng
-- biểu thức đó để mỗi lượt kiểm không quét cả bảng.
CREATE INDEX IF NOT EXISTS "insurance_orders_plate_key" ON "insurance_orders"
  (upper(regexp_replace("license_plate", '[^0-9A-Za-z]', '', 'g')))
  WHERE "product" = 'motorbike' AND "status" <> 'cancelled';
