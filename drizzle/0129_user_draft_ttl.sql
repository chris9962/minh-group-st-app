-- Thời hạn bản nháp tài khoản ngân hàng theo từng người (chốt 2026-10-07).
-- NULL = mặc định 30 phút. Danh sách người gán bằng `db:set-draft-ttl`.
ALTER TABLE users ADD COLUMN draft_ttl_minutes smallint CHECK (draft_ttl_minutes > 0);
--> statement-breakpoint
