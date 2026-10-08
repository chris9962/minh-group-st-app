-- Người bị nút "Thu hồi quyền sửa khách" ở P-99 rút customer:update (chốt 2026-10-08).
-- Giữ phạm vi cũ để nút "Cấp lại" trả đúng phạm vi đó.
CREATE TABLE customer_edit_revocations (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  scope scope_key NOT NULL,
  revoked_by uuid NOT NULL REFERENCES users(id),
  revoked_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
