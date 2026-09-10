-- Ba loại thông báo của module ngân hàng.
--
-- `ALTER TYPE ... ADD VALUE` chạy được trong transaction từ PostgreSQL 12, miễn
-- là KHÔNG dùng giá trị mới ngay trong cùng transaction đó. Migration này chỉ
-- thêm giá trị, không chèn dòng nào, nên an toàn.
--
-- Giá trị enum KHÔNG xoá được. Bỏ một loại thông báo thì gỡ khỏi
-- `NOTIFICATION_KINDS` ở `src/lib/api/notificationPrefs.ts`, giá trị vẫn nằm lại
-- trong enum và không gây hại.
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'bank-error';
--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'bank-pending';
--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'bank-approved';
