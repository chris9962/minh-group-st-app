<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Quy ước dự án MGST

Đọc file này trước khi viết dòng code nào. Nghiệp vụ nằm ở `../mgst-platform-spec.md`,
danh sách màn hình ở `../mgst-feature-list.md`, bản thiết kế ở `../mgst-design/`.

## 1. Ngôn ngữ

| | |
|---|---|
| **Tên biến, hàm, kiểu, file, class CSS, route** | **TIẾNG ANH** — không có ngoại lệ |
| **Comment, JSDoc, chuỗi hiển thị cho người dùng** | Tiếng Việt |

```ts
// ĐÚNG
/** Sai 5 lần liên tiếp thì khoá 15 phút. */
const MAX_ATTEMPTS = 5;
function scopeFor(user: User, action: Action) {}

// SAI
const soLanToiDa = 5;
function phamViCuaQuyen(nguoiDung: NguoiDung) {}
```

## 2. Component

**Mọi thứ dùng lại được đều nằm ở `src/components`.** Không style component ngay
trong `page.module.css`.

```
src/components/
  ui/        Button · TextField · Checkbox · Alert · Logo · …  (nguyên thuỷ)
  brand/     BrandPanel                                        (khối thương hiệu)
  <domain>/  theo nghiệp vụ, ví dụ banking/CodeCountdown
```

Quy tắc:

- Một component một file, tên file = tên component, PascalCase
- CSS đi kèm là `<Component>.module.css` nằm cạnh nó
- `page.module.css` **chỉ chứa bố cục riêng của trang đó** — không có `.button`, `.checkbox`, `.card`
- Cần dáng mới thì **thêm variant vào component**, đừng ghi đè style tại nơi dùng
- Thấy mình sắp chép CSS từ trang này sang trang khác → dừng lại, tách component

## 3. Style

- Nguồn sự thật là `src/styles/organic.css` — đồng bộ từ `../mgst-design/_ds`. **Không sửa tay.**
- Dùng token: `var(--color-accent)`, `var(--space-3)`, `var(--radius-md)`.
  **Không viết mã màu và khoảng cách cứng.** Ngoại lệ duy nhất: khối thương hiệu
  `BrandPanel` dùng đúng màu bộ nhận diện, có ghi chú lý do.
- Component của design system dùng qua class có sẵn: `.btn`, `.input`, `.card`, `.tag`, `.table`
- Không thêm Tailwind, không thêm thư viện component có style riêng — sẽ thành hai hệ thống

## 4. Kiểu dữ liệu

- **Schema zod ở `src/lib/types.ts` là nguồn sự thật duy nhất.** Kiểu TS suy ra bằng `z.infer`
- Không khai báo `interface` song song với schema
- Tránh `.default()` trong schema dùng cho form — zod v4 làm kiểu vào/ra lệch nhau,
  react-hook-form báo lỗi. Đặt mặc định ở `defaultValues`

## 5. Dữ liệu

- Component gọi `fetch('/api/...')` qua hàm trong `src/lib/api/`, **không import dữ liệu mock trực tiếp**
- Server state dùng TanStack Query. Client state dùng Zustand (`src/store/`)
- MSW ở `src/mocks/` trả lời như backend thật. Tắt bằng `NEXT_PUBLIC_USE_MOCK=false`
- Đổi từ mock sang thật **không được sửa component**

## 6. Phân quyền

- **Đúng một hàm kiểm quyền**: `src/lib/permissions.ts`. Mọi màn danh sách, chi tiết, xuất Excel đều qua đó
- Kiểm ở giao diện chỉ để ẩn/hiện. **Ẩn nút không phải là phân quyền** — máy chủ vẫn phải kiểm lại
- Hồ sơ **khách hàng** không áp trục phạm vi; chỉ **bản ghi nghiệp vụ** mới áp

## 7. React

- **Không dùng `useEffect` cho giá trị suy ra được** — tính thẳng khi render
- Không dùng `useEffect` để biến đổi dữ liệu cho việc render
- Xử lý tương tác trong event handler, không phải effect
- Reset state theo prop bằng `key`, không phải effect
- `useEffect` chỉ để đồng bộ với hệ thống bên ngoài, và phải có cleanup đúng

## 8. Khả năng tiếp cận

Đội KD dùng điện thoại **ngoài trời**. Đây không phải yêu cầu hình thức.

- Mọi input phải có `label` liên kết qua `id` — `TextField` đã lo
- Nút chỉ có icon phải có `aria-label`
- **Màu không được là kênh truyền đạt duy nhất** — luôn kèm chữ hoặc ký hiệu
- Vùng bấm tối thiểu 44px trên màn cảm ứng
- Dùng được bằng bàn phím, focus phải thấy được
- Không khoá zoom

## 9. Định dạng dữ liệu

Dùng `src/lib/format.ts`, không tự viết lại:

- Bỏ dấu tiếng Việt phải xử lý **`đ`/`Đ` → `d`/`D`** — `normalize('NFD')` không tách chữ Đ
- Tên khách khi **xuất Excel**: VIẾT HOA, BỎ DẤU. Lúc nhập không ràng buộc gì
- Cột SĐT và CCCD khi xuất phải ép **định dạng text**, nếu không Excel ăn mất số 0 đầu

## 10. Đặt tên tiếng Việt cho người dùng

Chuỗi hiển thị viết như người dùng nói, không như hệ thống nghĩ:
"Mở tài khoản" chứ không phải "Tạo bản ghi tài khoản ngân hàng".
