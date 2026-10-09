-- Chụp CCCD khi tạo khách theo từng người (chốt 2026-10-09).
-- Mức mặc định: tối đa một dòng; chưa có dòng thì đọc biến ID_CARD_SCAN như trước.
CREATE TABLE id_card_scan_default (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Ngoại lệ: người có dòng ở đây theo `enabled` của dòng, không theo mức mặc định.
CREATE TABLE id_card_scan_overrides (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  enabled boolean NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
