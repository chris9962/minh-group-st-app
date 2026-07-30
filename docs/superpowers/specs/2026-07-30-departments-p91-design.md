# P-91 · Màn quản lý phòng ban

> Chốt 30/07/2026. Nguồn nghiệp vụ: `../../../../mgst-platform-spec.md` (quyết định #30 · #31 · #32 · #32b · #43),
> mô tả màn: `../../../../mgst-feature-list.md` §4.9.

## Vấn đề

Chưa có route nào để quản lý phòng ban. 15 phòng đang viết cứng trong `src/mocks/data.ts`,
chỉ đọc ra để đổ vào ô lọc của P-51 và ô "Đơn vị" của form nhân viên. Lập phòng mới,
đổi tên hay cho một phòng ngừng hoạt động đều phải sửa code.

## Phạm vi

Danh sách phẳng: **tên · số người · trạng thái**. Ba việc: lập phòng mới, đổi tên,
cho ngừng hoạt động / mở lại.

Cố ý **không** làm, đã cân nhắc và loại:

| Không làm | Vì |
|---|---|
| Cây tổ chức, `loại` đơn vị, `đơn vị cha` | Quyết định #30: sơ đồ thật chỉ có công ty và phòng. `SCOPES` cũng chỉ có 3 mức, `visibleDepartmentIds` không đi theo cây — dựng cây ra thì phân quyền vẫn không hiểu nó, dễ tưởng đã chạy |
| Xoá phòng | Quyết định #32 giữ nguyên. Guard "không còn tham chiếu" chỉ chặn được id chết, không phân biệt "tạo sai tên" với "phòng thật đang rỗng" |
| Gán trưởng phòng ngay tại màn này | `manageScope` / `managedDepartmentIds` thuộc hồ sơ người, sửa ở P-53. Quyết định #43: **thuộc về** và **quản lý** là hai quan hệ tách rời |

## Quyền

Thêm hành động `manage-org` vào trục 2. Cấp cho Giám đốc và Quản trị hệ thống.

| File | Sửa |
|---|---|
| `src/lib/types.ts` | thêm `'manage-org'` vào enum `Action` |
| `src/lib/roles.ts` | `p('system', 'manage-org', 'company')` vào `directorPermissions` |
| `src/mocks/data.ts` | thêm dòng trên vào `sysAdminPermissions` |
| `src/lib/nav.ts` | thêm `'org'` vào union `NavIconKey`; mục **Phòng ban**, `href: '/departments'`, `icon: 'org'`, `screen: 'P-91'`, gate `can(user, 'system', 'manage-org')` |
| `src/components/layout/NavIcon.tsx` | `org: Building2` vào bảng `ICONS` — nó `satisfies Record<NavIconKey, unknown>` nên thiếu là tsc chặn ngay |

Kiểm ở giao diện chỉ để ẩn/hiện. Mọi handler phải kiểm lại — ẩn nút không phải phân quyền.

## Dữ liệu

`Department` **giữ nguyên** `{ id, name, active }`. `/api/departments` không đổi, nên
P-51 và `StaffFormDialog` không bị đụng tới.

Màn quản lý cần số người mỗi phòng để chặn ngừng hoạt động, nên đi endpoint riêng
thay vì nhồi field vào type dùng chung:

```
GET  /api/org/departments             → { departments: DepartmentRow[], summary }
POST /api/org/departments             → tạo
POST /api/org/departments/:id         → đổi tên
POST /api/org/departments/:id/active  → ngừng / mở lại
```

`DepartmentRow = Department & { headcount: number }`
`summary = { total: number; active: number; stopped: number }`

`src/lib/api/org.ts` đặt tên soi gương `staff.ts`:
`DepartmentForm` · `fetchDepartmentRows` · `createDepartment` · `updateDepartment` · `setDepartmentActive`

`DepartmentForm` là schema zod, không khai `interface` song song:

```ts
export const DepartmentForm = z.object({
  name: z.string().trim().min(2, 'Chưa nhập tên phòng'),
});
```

Không dùng `.default()` — zod v4 làm kiểu vào/ra lệch nhau, react-hook-form báo lỗi.
Mặc định đặt ở `defaultValues`.

## Quy tắc nghiệp vụ

**Không xoá cứng.** Chỉ *Ngừng hoạt động* / *Mở lại*. Bản ghi lưu **id** phòng (#31)
nên xoá là để lại id chết trong dữ liệu cũ.

**Chặn ngừng hoạt động phòng còn người** (#32b). Nút bị vô hiệu, kèm **câu lý do hiện
thành chữ** cạnh nút: *"Còn 2 người, chuyển họ sang phòng khác trước."* Nút mờ mà không
nói vì sao chính là chỗ người dùng mắc kẹt. Máy chủ kiểm lại và trả
`DEPARTMENT_NOT_EMPTY`.

**Trùng tên** → `NAME_TAKEN`. So sánh sau khi `trim`, không phân biệt hoa thường.

**Mở lại** thì không chặn gì — phòng rỗng mở lại được, phòng còn người càng phải mở được.

## Giao diện

Theo đúng khuôn P-51:

```
TopBar  "Phòng ban"  ·  SearchField  ·  [+ Thêm phòng ban]
─────────────────────────────────────────────────────────
[ 15 phòng ]     [ 13 đang hoạt động ]    [ 2 đã ngừng ]
─────────────────────────────────────────────────────────
SectionCard "Phòng ban"  (icon Building2, size 17)
  RankTable
    Tên phòng | Số người ⇅ | Trạng thái | Thao tác
```

- **Số người**: `align: "right"`, có `sortBy` → ô nhận class `.tabular-nums`
- **Trạng thái**: `StatusTag ok={active}` → *Đang hoạt động* / *Đã ngừng*
- **Thao tác**: nút icon `Pencil` (Sửa) + nút chữ *Ngừng hoạt động* / *Mở lại*
- Nút chỉ có icon phải có `aria-label` **kèm tên phòng** — giữa 15 dòng giống nhau,
  "Sửa" một mình không nói đang sửa phòng nào
- Hộp thoại tạo/sửa: đúng một ô *Tên phòng*, placeholder `Phòng Kinh doanh 10`

File mới:

```
src/app/(app)/departments/page.tsx
src/app/(app)/departments/page.module.css
src/components/departments/DepartmentFormDialog.tsx
src/components/departments/DepartmentFormDialog.module.css
src/lib/api/org.ts
src/mocks/org.ts
```

`page.module.css` chỉ chứa bố cục riêng của trang. Không có `.button`, `.card`.
Grid thẻ số dùng 3 cột, khớp `people/page.module.css`.

## Đồng bộ cache

Lưu xong phải `invalidateQueries` cả hai khoá, không chỉ khoá của màn này:

- `['org-departments']` — bảng của chính màn P-91
- `['departments']` — ô lọc P-51 và ô "Đơn vị" của form nhân viên, nếu không thì
  lập phòng mới xong vào P-51 vẫn không thấy phòng đó

## Xác minh

Dự án **chưa có test runner** — `package.json` không có vitest/jest. Không giả vờ viết
test. Xác minh bằng:

1. `bunx tsc --noEmit` sạch
2. `bun run lint` không phát sinh vấn đề mới (nền hiện tại: 5 vấn đề có sẵn ở
   `mockServiceWorker.js`, `AccountCard.tsx`, `StaffFormDialog.tsx`, `ProgressRing.tsx`)
3. Lái preview qua đủ 6 đường:
   - Đăng nhập `giamdoc` → sidebar có mục **Phòng ban**
   - Đăng nhập `tpkd2` (trưởng phòng, không có `manage-org`) → **không** có mục đó
   - Lập phòng mới → sang P-91 thấy nó, sang P-51 mở bộ lọc cũng thấy nó
   - Đổi tên một phòng → bảng và ô lọc đều đổi theo
   - Thử ngừng Phòng KD 2 (5 người) → nút vô hiệu, có câu lý do nêu số người
   - Ngừng một phòng rỗng (Phòng An Sinh) → thành *Đã ngừng*, rồi Mở lại được

Số liệu nền để đối chiếu, đo từ mock ngày 30/07: 15 phòng; 6 phòng còn người
(KD 2 có 5 · KD 6 có 3 · KD 7 có 3 · KD 1 có 2 · KD tổng hợp có 2 · Kế toán tổng hợp có 1);
Phòng An Sinh và Phòng Y đang rỗng.

## Việc kéo theo, KHÔNG làm trong lần này

- `visibleDepartmentIds` chưa được thử thật: mock giả lập phạm vi bằng
  `ALL.slice(0, TAKE[scope])` (`src/mocks/people.ts`), không đọc `managedDepartmentIds`.
  Lọc theo phòng vì vậy chưa có đường dữ liệu nào chạy qua
- Ngừng hoạt động một phòng hiện **không** cảnh báo người đang quản phòng đó
  (`managedDepartmentIds` vẫn trỏ vào phòng đã ngừng)
- `mgst-decisions-log.md` đang bị **lặp nguyên một khối** (dòng ~60–94 trùng dòng ~30–64)
