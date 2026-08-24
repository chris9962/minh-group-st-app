-- Ảnh QR của mã giới thiệu — LƯU LẠI, không còn là vật trung gian.
--
-- Bản trước giải chuỗi ra rồi bỏ ảnh (migration 0027). Nhưng bước 2 của P-20
-- cần chính tấm ảnh: nhân viên đưa điện thoại cho khách quét, mở link trên máy
-- mình không thay được việc đó.
--
-- Lưu KHOÁ trong kho ảnh, cùng luật với `bank_account_photos.url`. NULL = mã
-- chưa có ảnh, gồm mọi mã lập trước migration này.
ALTER TABLE "referral_codes" ADD COLUMN "qr_image" text;
