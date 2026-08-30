-- P-96 · Hộp góp ý (chốt 2026-08-30) — quyền mới `system:handle-feedback` và
-- bảng `feedbacks`, mỗi lần gửi một dòng.
--
-- ⚠️ File này KHÔNG được dùng giá trị enum vừa thêm — drizzle bọc cả loạt
-- migration vào MỘT transaction, mà Postgres cấm dùng giá trị enum trong cùng
-- transaction với ADD VALUE (cùng lối migration 0046 và 0050). Phần cấp
-- `*:handle-feedback` cho tài khoản toàn quyền vì thế nằm ở script
-- `db:grant-handle-feedback`, chạy SAU migrate.
ALTER TYPE "action_key" ADD VALUE IF NOT EXISTS 'handle-feedback';
--> statement-breakpoint

CREATE TYPE "feedback_status" AS ENUM ('pending', 'done');
--> statement-breakpoint

CREATE TABLE "feedbacks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "content" text NOT NULL,
  -- Đường dẫn trang lúc người dùng bấm nút Góp ý. Không có nó thì góp ý kiểu
  -- "bảng này sai số" không tra được là bảng nào.
  "path" text NOT NULL DEFAULT '',
  "status" "feedback_status" NOT NULL DEFAULT 'pending',
  "handled_by" uuid REFERENCES "users"("id"),
  "handled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "feedbacks_content_not_blank" CHECK (btrim(content) <> '')
);
--> statement-breakpoint

-- Hai chỉ mục vì màn P-96 có ô lọc trạng thái: lọc rồi sắp theo thời gian đi
-- chỉ mục thứ hai, không lọc thì đi chỉ mục thứ nhất.
--
-- `nulls last` khớp đúng chiều `orderKeys` sinh ra ở `server/feedback.ts`. Hai
-- chiều lệch nhau thì planner bỏ chỉ mục — xem chú thích dài ở `server/audit.ts`.
CREATE INDEX "feedbacks_created" ON "feedbacks" ("created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "feedbacks_status_created" ON "feedbacks" ("status", "created_at" DESC NULLS LAST);
