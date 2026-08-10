-- Snapshot phòng của NGƯỜI LẬP HỒ SƠ KHÁCH, theo quyết định #8 (db-design §0).
--
-- Vì sao khách cũng cần cột này, không chỉ bản ghi nghiệp vụ: thể lệ kỳ 2026-08
-- mục 4 lưu ý 2 cho Phòng Y quy đổi quà TH5/TH6 sang nón bảo hiểm và thùng mì,
-- và "phòng của khách" đọc theo phòng người lập hồ sơ (thể lệ mục 7, câu 7.11 —
-- cùng trục với điểm KPI). Trước migration này `giftInputFor` phải nối sống sang
-- `users.department_id`, nên nhân viên luân chuyển phòng là rổ quà của khách CŨ
-- đổi theo cả hai chiều: rời Phòng Y thì khách mất món đã hứa và `grantGift` trả
-- `NOT_IN_BASKET`; vào Phòng Y thì khách cũ tự nhiên có thêm món.
ALTER TABLE "customers" ADD COLUMN "created_by_department_id" uuid;--> statement-breakpoint
-- Backfill TRƯỚC khi gắn ràng buộc. Phòng HIỆN TẠI của người tạo là ước lượng
-- tốt nhất cho phòng lúc tạo — không còn nguồn nào khác dựng lại được, vì đây
-- chính là dữ liệu mà cột này sinh ra để thôi phải tra. Khách do người đã bị xoá
-- hoặc chưa gán phòng thì để `null`, và luật đọc `null` là "không phải Phòng Y".
UPDATE "customers" AS c
   SET "created_by_department_id" = u."department_id"
  FROM "users" AS u
 WHERE u."id" = c."created_by";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_department_id_departments_id_fk" FOREIGN KEY ("created_by_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
