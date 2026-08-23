-- Hạ phạm vi hồ sơ khách của cấp quản lý xuống phòng mình quản (chốt 2026-08-23).
--
-- Bộ quyền mặc định ở `lib/roles.ts` đã đổi, nhưng chức vụ KHÔNG phải nguồn
-- quyền (AGENTS.md §6): quyền thật nằm ở từng dòng `user_permissions`, và các
-- dòng đã cấp giữ nguyên `company` mãi mãi nếu không có câu này. Không chạy nó
-- thì thay đổi kia chỉ có tác dụng với người được tạo hồ sơ SAU hôm nay.
--
-- Giám đốc mang quyền `*` nên không có dòng `customer` nào để đụng.
--
-- ⚠️ Người quản 0 phòng sẽ thấy danh sách RỖNG sau câu này — `managed` là tập
-- phòng được giao, không rơi về phòng mình thuộc về. Đúng với thiết kế sẵn có
-- của `recordVisibility`, và cách sửa là giao phòng cho họ ở màn Nhân sự.
UPDATE "user_permissions" up
SET "scope" = 'managed'
FROM "users" u
WHERE up."user_id" = u."id"
  AND u."role" IN ('head', 'deputy-head', 'deputy-director')
  AND up."module" = 'customer'
  AND up."action" IN ('view-detail', 'export')
  AND up."scope" = 'company';

-- Nhân viên: `company` → `own`.
--
-- Mức `company` cũ không mô tả cái gì thật. Bảng P-40 vẫn chỉ hiện khách họ
-- lập, bằng một điều kiện `role = 'staff'` đặt thẳng ở route. `company` chỉ tồn
-- tại để ô tìm khách chạy được, mà ô đó nay đi `/api/customers/lookup` — route
-- riêng, mở toàn công ty và không đọc quyền này.
--
-- Hạ xuống `own` đổi hai thứ. Bảng P-40 lọc bằng phạm vi thay vì bằng chức vụ,
-- nên tài khoản mang vai Nhân viên mà được cấp quyền rộng hơn nay thấy rộng hơn
-- thật. Và trần phát quyền của Trưởng phòng hạ theo: trước đây họ cấp được mức
-- `Toàn công ty` cho người dưới quyền, vì trần đó lấy từ bộ quyền của vai Nhân
-- viên.
UPDATE "user_permissions" up
SET "scope" = 'own'
FROM "users" u
WHERE up."user_id" = u."id"
  AND u."role" = 'staff'
  AND up."module" = 'customer'
  AND up."action" = 'view-detail'
  AND up."scope" = 'company';
