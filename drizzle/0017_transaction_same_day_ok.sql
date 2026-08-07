-- Bỏ ràng buộc "ngày giao dịch phải khác ngày mở tài khoản" (chốt 07/08).
--
-- Ràng buộc dựng theo chữ trong thể lệ mục 1 ("khác ngày mở tk"), nhưng CEO xác
-- nhận đọc vậy là SAI: khách giao dịch ngay trong ngày mở vẫn được tính. Ràng
-- buộc này chặn đúng ca hay gặp nhất ngoài hiện trường.
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_transaction_other_day";
