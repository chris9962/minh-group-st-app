-- Mã text không còn là khoá: cùng một chuỗi ngân hàng cấp có thể nhập thành
-- nhiều dòng trong cùng ngân hàng và loại tài khoản, phân biệt bằng tên hiển thị.
-- Ràng buộc còn lại: referral_codes_bank_display_name (bank_id, account_type, display_name).
DROP INDEX "referral_codes_bank_code";
