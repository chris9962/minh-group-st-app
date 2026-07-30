# Chi tiết phòng ban (mở rộng P-91)

> Chốt 30/07/2026. Nối tiếp `2026-07-30-departments-p91-design.md`. Nguồn nghiệp vụ:
> `../../../../mgst-platform-spec.md` (quyết định #43 · #44), mô tả màn: chưa có mã P-
> riêng — đây là phần mở rộng của P-91, bấm tên phòng ở bảng đi tới.

## Vấn đề

P-91 chỉ có danh sách phẳng, không bấm vào đâu được để xem thêm. Muốn biết một phòng
đang ai quản, có những ai trong đó phải mở P-51 rồi tự lọc theo đơn vị.

## Phạm vi

Bấm tên phòng ở bảng P-91 → sang `/departments/:id`. Màn mới hiện:

1. **Người quản lý** — chỉ tính cấp Phó GĐ / Giám đốc, không tính Trưởng·Phó phòng
2. **Danh sách nhân viên** — mọi người có `departmentId` là phòng này, Trưởng·Phó phòng
   xem như nhân viên nhưng sắp lên đầu bảng

Chỉ xem, không có hành động sửa nào ở màn này — sửa hồ sơ người vẫn ở P-51/P-52, sửa
tên/trạng thái phòng vẫn ở P-91. Trùng chỗ sửa thì hai màn sớm muộn lệch nhau
(giống lý do #43 tách "thuộc về" khỏi "quản lý").

## Người quản lý

**Quy tắc** (khớp bảng "Ai quản gì" ở spec nghiệp vụ):

```
managers = mockUsers có role === 'deputy-director'
                    và manageScope === 'listed'
                    và managedDepartmentIds chứa id phòng này

Nếu managers rỗng → fallback lấy người role === 'director' (#44: Giám đốc
dùng company, không liệt kê từng phòng nên không tự nhiên nằm trong
managedDepartmentIds của ai)
```

Cố ý **không** gồm Trưởng phòng / Phó phòng ở đây — theo yêu cầu, họ được xem như
nhân viên của phòng, chỉ khác là sắp lên đầu danh sách nhân viên bên dưới.

Cố ý **không** lọc theo `role === 'director'` bằng cách check `manageScope === 'company'`
chung chung — vài tài khoản staff (quản trị hệ thống, đội tạo đơn, kế toán/kinh doanh
tổng hợp) cũng có `manageScope: 'company'` nhưng vì quyền module khác, không phải vì họ
quản phòng ban nào. Lọc theo `role` tránh nhầm họ thành "người quản lý".

## Dữ liệu

`src/lib/api/org.ts` thêm:

```ts
export const DepartmentManager = z.object({
  id: z.string(),
  fullName: z.string(),
  title: z.string(),
});
export type DepartmentManager = z.infer<typeof DepartmentManager>;

export const DepartmentDetail = z.object({
  department: DepartmentRow,
  managers: z.array(DepartmentManager),
  /** true = không ai ở cấp Phó GĐ quản, đang hiện Giám đốc theo mặc định. */
  managedByDefault: z.boolean(),
});
export type DepartmentDetail = z.infer<typeof DepartmentDetail>;

export async function fetchDepartmentDetail(id: string): Promise<DepartmentDetail> {
  const res = await fetch(`/api/org/departments/${id}`);
  if (!res.ok) throw new Error('Không tải được phòng ban này');
  return DepartmentDetail.parse(await res.json());
}
```

`src/mocks/org.ts` thêm `departmentDetailFor(id): DepartmentDetail | null` (null khi
không tìm thấy phòng → route trả 404).

Danh sách nhân viên **không cần API mới** — tái dùng `fetchStaff` đã có:

```ts
fetchStaff({ departmentId: id, status: 'all', roles: [], search: '', scope: 'company' })
```

`status: 'all'` để khớp cách P-91 tính headcount — **gồm cả người đã khoá**, vì họ vẫn
thuộc phòng này.

## Giao diện

Theo khuôn `people/[id]/page.tsx`: `TopBar` tên phòng, dòng quay lại `/departments`,
không cần bố cục hai cột (không có biểu đồ/điểm) nên xếp dọc:

```
TopBar  "<Tên phòng>"
← Phòng ban
─────────────────────────────────────────
SectionCard "Người quản lý"
  mỗi người một dòng: tên (Link → /people/:id) · chức danh
  managedByDefault → footnote: "Phòng này chưa có Phó GĐ phụ trách,
    Giám đốc quản trực tiếp."
─────────────────────────────────────────
SectionCard "Nhân viên"
  RankTable: Tên (Link → /people/:id) | Chức vụ ⇅ | Trạng thái
  defaultSort = "role", cột Chức vụ có sortBy trả điểm ưu tiên
  (head=2, deputy-head=1, còn lại=0) — RankTable mặc định sort giảm dần
  nên Trưởng/Phó phòng tự lên đầu, bấm cột khác vẫn đổi được như thường
  Trạng thái: StatusTag, đúng chữ "Đang hoạt động"/"Đã khoá" như AccountCard.tsx
```

Ở `departments/page.tsx`, cột "Tên phòng" đổi từ text sang
`<Link href={`/departments/${d.id}`} className={styles.nameLink}>` — thêm
`.nameLink` vào `page.module.css` (sao y class cùng tên ở `people/page.module.css`).

## Quyền

Không thêm gate mới. P-91 hiện tại chỉ ẩn/hiện nút **Thêm phòng ban** theo quyền
`manage-org`, còn xem danh sách và (giờ thêm) xem chi tiết thì không chặn — nav ẩn
mục *Phòng ban* với người không có quyền là đủ, vào thẳng URL vẫn xem được. Màn chi
tiết không có hành động sửa nào nên không có gì để gate thêm.

## File mới / sửa

```
src/app/(app)/departments/[id]/page.tsx          mới
src/app/(app)/departments/[id]/page.module.css   mới
src/lib/api/org.ts                                thêm DepartmentManager, DepartmentDetail, fetchDepartmentDetail
src/mocks/org.ts                                  thêm departmentDetailFor
src/mocks/handlers.ts                             thêm GET /api/org/departments/:id
src/app/(app)/departments/page.tsx                tên phòng thành Link
src/app/(app)/departments/page.module.css         thêm .nameLink
```

## Xác minh

Dự án chưa có test runner. Xác minh bằng:

1. `bunx tsc --noEmit` sạch
2. `bun run lint` không phát sinh vấn đề mới
3. Lái preview:
   - Từ P-91 bấm tên **Phòng KD 2** → sang chi tiết, mục Người quản lý hiện
     **Phó Giám Đốc 2** (không hiện Trưởng phòng KD2 ở đây)
   - Bảng nhân viên của KD 2: **Trần Văn Hậu (Trưởng phòng)** nằm dòng đầu
   - Bấm tên **Phòng An Sinh** hoặc **Phòng Y** → Người quản lý hiện
     **Giám đốc**, kèm câu giải thích không có Phó GĐ phụ trách
   - Bấm tên một nhân viên trong bảng → mở đúng hồ sơ P-52 của người đó
   - Vào thẳng URL `/departments/:id` với id không tồn tại → hiện thông báo lỗi,
     không crash
