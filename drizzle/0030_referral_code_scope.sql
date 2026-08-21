-- Phạm vi phòng của mã giới thiệu (spec §4.4d).
--
-- `scope = 'all'` là mã dùng chung cho cả công ty; `'departments'` là chỉ những
-- phòng có dòng trong `referral_code_departments` mới chọn được mã.
--
-- Ý ĐỊNH nằm ở cột `scope`, KHÔNG suy từ số dòng bảng nối: người dùng chọn hai
-- phòng rồi bỏ chọn cả hai thì bảng nối cũng rỗng, mà "cho tất cả" và "chưa
-- chọn phòng nào" là hai ý trái ngược nhau.
--
-- Mọi mã đang có nhận 'all' nên hành vi hiện tại không đổi.
ALTER TABLE "referral_codes" ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'all';

-- Bảng nối chứ không phải cột mảng `uuid[]`: có khoá ngoại thật tới
-- `departments` nên không sinh được id phòng không tồn tại, và câu lọc
-- `exists (…)` dùng index bình thường.
CREATE TABLE IF NOT EXISTS "referral_code_departments" (
  "referral_code_id" uuid NOT NULL REFERENCES "referral_codes"("id") ON DELETE CASCADE,
  "department_id"    uuid NOT NULL REFERENCES "departments"("id"),
  PRIMARY KEY ("referral_code_id", "department_id")
);

-- Câu lọc lúc mở tài khoản đi từ MỘT phòng ra danh sách mã, nên index theo
-- `department_id`; khoá chính đã lo chiều ngược lại.
CREATE INDEX IF NOT EXISTS "referral_code_departments_department"
  ON "referral_code_departments" ("department_id");
