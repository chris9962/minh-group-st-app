-- `gift_grants.chosen_item` đổi từ TÊN món sang MÃ món (quyết định #74).
--
-- Tên thì admin sửa được ở P-82 bất cứ lúc nào. Sau lần sửa đó, giá trị trong
-- cột không tra ngược ra món nào, và màn Tổng quan gộp theo cột này nên một món
-- tách thành hai dòng: tên cũ và tên mới.
--
-- Mã lấy từ chính `snapshot.basket` của mỗi dòng — nó đã đóng băng đủ cặp
-- `code` + `name` lúc phát, nên không phải đoán.
UPDATE "gift_grants" g
   SET "chosen_item" = coalesce(
         (SELECT b->>'code'
            FROM jsonb_array_elements(g."snapshot"->'basket') b
           WHERE b->>'name' = g."chosen_item"
           LIMIT 1),
         -- Câu từ chối cũ là chuỗi tiếng Việt, nay thành mã `DECLINED`.
         CASE WHEN g."chosen_item" = 'Từ chối nhận quà' THEN 'DECLINED'
              ELSE g."chosen_item" END);
