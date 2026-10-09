-- Lỗi phía trình duyệt gửi về qua POST /api/client-errors (chốt 2026-10-09).
-- Trước mắt dùng để soi lỗi camera ở màn chụp CCCD; chưa có màn xem, đọc bằng SQL.
CREATE TABLE client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  source text NOT NULL,
  message text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text NOT NULL DEFAULT '',
  path text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX client_errors_created ON client_errors (created_at DESC);
