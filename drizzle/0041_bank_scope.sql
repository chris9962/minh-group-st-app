-- Phạm vi quản lý ngân hàng (chốt 2026-08-24).
--
-- Ba việc trong một file, đúng thứ tự bắt buộc.

-- 1. Ai đang có `manage-referral-codes` thì nhận `manage-bank` thay thế.
--
-- Giữ nguyên `module` và `scope` của dòng cũ. `on conflict do nothing` cho ca
-- người đó đã có sẵn `manage-bank` — mọi tài khoản trên dev đang như vậy, vì bộ
-- quyền cũ cấp cả hai cùng lúc.
INSERT INTO user_permissions (user_id, module, action, scope)
SELECT user_id, module, 'manage-bank'::action_key, scope
FROM user_permissions
WHERE action = 'manage-referral-codes'
ON CONFLICT (user_id, module, action) DO NOTHING;
--> statement-breakpoint

-- 2. Dọn dòng cũ. Hành động này không còn điểm gác nào đọc tới.
--
-- KHÔNG xoá giá trị khỏi enum: Postgres không bỏ được một giá trị enum, và
-- `audit_log.action` còn giữ lịch sử những lượt cấp quyền mang tên đó.
DELETE FROM user_permissions WHERE action = 'manage-referral-codes';
--> statement-breakpoint

-- 3. Ngân hàng này ai quản.
--
-- Nhiều-nhiều CẢ HAI CHIỀU: một người quản nhiều ngân hàng, một ngân hàng có
-- nhiều người quản. Khoá chính hai cột cho sẵn điều đó — KHÔNG thêm ràng buộc
-- duy nhất trên `bank_id`, vì đó đúng là thứ chặn người quản thứ hai.
--
-- Không index thêm: bảng này lớn nhất bằng số người quản nhân 13 ngân hàng, và
-- nó không lớn thêm theo ngày làm việc (AGENTS.md §5.2).
CREATE TABLE "user_managed_banks" (
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "bank_id" uuid NOT NULL REFERENCES "banks"("id"),
  PRIMARY KEY ("user_id", "bank_id")
);
--> statement-breakpoint

-- 4. Người này quản MỌI ngân hàng, hay chỉ ngân hàng được giao.
--
-- Trục RIÊNG, không mượn `scope_key`. `own` của trục đó nghĩa là "bản ghi do
-- chính tôi tạo" (spec §1.1.2), mà ngân hàng không thuộc về ai — bảng `banks`
-- không có cột chủ sở hữu, và ai đăng nhập cũng đọc được danh sách.
--
-- Cũng KHÔNG suy từ số dòng của `user_managed_banks`: bảng rỗng có hai nghĩa
-- trái ngược — "mọi ngân hàng" với "chưa ngân hàng nào" — đúng chỗ dễ sai mà
-- `referral_codes.scope` đã giải cùng cách này.
--
-- Mặc định `all` để mọi tài khoản đang có giữ nguyên hành vi. Người cấp quyền
-- phải chủ động đổi sang `listed`.
CREATE TYPE "bank_scope" AS ENUM ('all', 'listed');
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bank_scope" "bank_scope" NOT NULL DEFAULT 'all';
