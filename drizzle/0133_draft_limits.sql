-- Trần bản nháp mỗi nhân viên giữ cùng lúc ở một ngân hàng, theo loại tài khoản (chốt 2026-10-09).
-- Mức mặc định: tối đa một dòng; chưa có dòng thì dùng 1/1/1 trong code.
CREATE TABLE draft_limit_default (
  id smallint PRIMARY KEY DEFAULT 1,
  limit_none smallint NOT NULL,
  limit_cnkd smallint NOT NULL,
  limit_hkd smallint NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT draft_limit_default_single_row CHECK (id = 1),
  CONSTRAINT draft_limit_default_positive CHECK (limit_none >= 1 AND limit_cnkd >= 1 AND limit_hkd >= 1)
);
--> statement-breakpoint
-- Ngoại lệ: người có dòng ở đây theo trần của dòng, không theo mức mặc định.
CREATE TABLE draft_limit_overrides (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  limit_none smallint NOT NULL,
  limit_cnkd smallint NOT NULL,
  limit_hkd smallint NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT draft_limit_overrides_positive CHECK (limit_none >= 1 AND limit_cnkd >= 1 AND limit_hkd >= 1)
);
