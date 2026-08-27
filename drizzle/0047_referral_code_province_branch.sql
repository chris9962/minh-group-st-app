-- Mã giới thiệu thêm tỉnh + chi nhánh hỗ trợ + công tắc ngừng (chốt 2026-08-27).
--
-- `province` lưu TÊN tỉnh chọn từ 34 tỉnh tham chiếu, `support_branch` người
-- dùng gõ tay — cả hai hiện ở bước 2 khi mở tài khoản, cạnh ô chọn mã.
--
-- `active`: trước đây mã chỉ dừng khi tiêu hết `total`; công tắc này cho ngừng
-- tay — mã tắt rời ô chọn và bị chốt trong `startBankAccount` từ chối.
ALTER TABLE "referral_codes"
  ADD COLUMN "province" text NOT NULL DEFAULT '',
  ADD COLUMN "support_branch" text NOT NULL DEFAULT '',
  ADD COLUMN "active" boolean NOT NULL DEFAULT true;
