-- Rổ quà PHỤ của khách HKD (chốt 2026-09-17): Loa và Bảng mica tách khỏi rổ
-- chính, khách lấy một món ở đây CỘNG gói bảo hiểm của combo. Bản trước trộn
-- chung một rổ nên khách HKD đạt TH5 phải bỏ gói bảo hiểm mới lấy được loa.
ALTER TABLE "gift_grants" ADD COLUMN "extra_item" text;
--> statement-breakpoint

-- Đợt đã phát mà khách HKD lấy Loa hoặc Bảng mica làm quà chính: dời món đó
-- sang quà thêm. Nhận ra bằng `source` trong rổ đóng băng, không suy từ tài
-- khoản hiện tại: tài khoản HKD có thể đã bị đánh lỗi sau lượt phát.
--
-- Quà chính đặt lại theo rổ lúc phát:
--   rổ chỉ có Loa và Bảng mica  → 'NONE'      khách không có gì để chọn
--   rổ còn gói bảo hiểm          → 'UNCHOSEN'  khách còn một gói chưa chọn
UPDATE "gift_grants" g
SET
  "extra_item" = g."chosen_item",
  "chosen_item" = CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(g."snapshot"->'basket') b
      WHERE b->>'code' NOT IN ('QUA-LOA', 'QUA-MICA')
    ) THEN 'UNCHOSEN'
    ELSE 'NONE'
  END
WHERE g."chosen_item" IN ('QUA-LOA', 'QUA-MICA')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(g."snapshot"->'basket') b
    WHERE b->>'code' = g."chosen_item" AND b->>'source' = 'Khách có HKD'
  );
--> statement-breakpoint

-- Nhật ký đổi quà ghi rõ dòng đó đổi quà chính hay quà thêm: hai cột from/to
-- dùng chung, thiếu cột này thì "Đổi sang Loa" không nói được khách vẫn giữ
-- gói bảo hiểm.
ALTER TABLE "gift_grant_changes" ADD COLUMN "part" text NOT NULL DEFAULT 'main';
--> statement-breakpoint
ALTER TABLE "gift_grant_changes" ADD CONSTRAINT "gift_grant_changes_part" CHECK (part in ('main', 'extra'));
