# Chi tiết phòng ban — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bấm tên phòng ở bảng P-91 mở màn chi tiết `/departments/:id`, hiện người quản lý
cấp Phó GĐ/GĐ và danh sách nhân viên (Trưởng/Phó phòng sắp lên đầu).

**Architecture:** Thêm một endpoint mock mới (`GET /api/org/departments/:id`) trả
`DepartmentDetail` (phòng + người quản lý), tái dùng `fetchStaff` sẵn có cho danh sách
nhân viên. Trang mới theo khuôn `people/[id]/page.tsx` nhưng bố cục một cột (không có
biểu đồ/điểm). Cột "Tên phòng" ở P-91 đổi thành link sang trang mới.

**Tech Stack:** Next.js App Router (client component + `use(params)`), TanStack Query,
zod, MSW (mock server chạy trong trình duyệt).

## Global Constraints

- Tên biến/hàm/file/route: tiếng Anh. Chuỗi hiển thị cho người dùng: tiếng Việt (AGENTS.md §1)
- Không khai `interface` song song với schema zod — kiểu suy ra bằng `z.infer` (AGENTS.md §4)
- Component gọi `fetch` qua hàm trong `src/lib/api/`, không import mock trực tiếp (AGENTS.md §5)
- Không mã màu/khoảng cách cứng — chỉ dùng token `--om-*` có sẵn (AGENTS.md §3)
- Nút chỉ có icon phải có `aria-label`; vùng bấm tối thiểu 44px (AGENTS.md §8) — không áp
  dụng trực tiếp ở đây vì trang này không có nút icon nào, chỉ có link chữ
- Dự án **không có test runner** (`package.json` không có vitest/jest). Xác minh bằng
  `bunx tsc --noEmit`, `bun run lint`, và lái thử qua trình duyệt — không viết test giả

---

### Task 1: Dữ liệu & endpoint chi tiết phòng ban

**Files:**
- Modify: `src/lib/api/org.ts`
- Modify: `src/mocks/org.ts`
- Modify: `src/mocks/handlers.ts`

**Interfaces:**
- Consumes: `DepartmentRow` (đã có ở `src/lib/api/org.ts`), `Department` (`@/lib/types`),
  `mockUsers` (`./data`, mỗi phần tử kiểu `User & { password: string }` với các trường
  `role: RoleKey`, `manageScope: ManageScope`, `managedDepartmentIds: string[]`,
  `fullName: string`, `title: string`), `headcountOf(departmentId: string): number`
  (`./staff`)
- Produces: type `DepartmentManager = { id: string; fullName: string; title: string }`,
  type `DepartmentDetail = { department: DepartmentRow; managers: DepartmentManager[]; managedByDefault: boolean }`,
  hàm `fetchDepartmentDetail(id: string): Promise<DepartmentDetail>` (ném lỗi khi
  response không `ok`), hàm mock `departmentDetailFor(id: string): DepartmentDetail | null`
  (null khi không tìm thấy phòng), route `GET /api/org/departments/:id`

- [ ] **Step 1: Thêm schema và hàm fetch vào `src/lib/api/org.ts`**

Chèn ngay sau khối `DepartmentList` (sau dòng `export type DepartmentList = z.infer<typeof DepartmentList>;`, trước comment `/** Biểu mẫu lập / đổi tên phòng. */`):

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
```

Chèn hàm fetch ngay sau hàm `fetchDepartmentRows` (trước comment
`/** Lỗi nghiệp vụ ném ra dạng OrgError... */`):

```ts
export async function fetchDepartmentDetail(id: string): Promise<DepartmentDetail> {
  const res = await fetch(`/api/org/departments/${id}`);
  if (!res.ok) throw new Error('Không tải được phòng ban này');
  return DepartmentDetail.parse(await res.json());
}
```

- [ ] **Step 2: Thêm `departmentDetailFor` vào `src/mocks/org.ts`**

Đổi import ở đầu file từ:

```ts
import {
  ORG_ERROR,
  type DepartmentForm,
  type DepartmentList,
  type DepartmentRow,
  type OrgErrorCode,
} from "@/lib/api/org";
import { matchesSearch, removeDiacritics } from "@/lib/format";
import { departments } from "./data";
import { headcountOf } from "./staff";
```

thành:

```ts
import {
  ORG_ERROR,
  type DepartmentDetail,
  type DepartmentForm,
  type DepartmentList,
  type DepartmentRow,
  type OrgErrorCode,
} from "@/lib/api/org";
import { matchesSearch, removeDiacritics } from "@/lib/format";
import { departments, mockUsers } from "./data";
import { headcountOf } from "./staff";
```

Thêm hàm ở cuối file `src/mocks/org.ts`:

```ts
/**
 * Người quản lý một phòng — chỉ tính cấp Phó GĐ trở lên. Trưởng/Phó phòng
 * không tính ở đây, họ hiện trong danh sách nhân viên của chính phòng đó.
 *
 * Cố ý lọc theo `role`, không lọc theo `manageScope === 'company'` chung
 * chung — vài tài khoản staff (quản trị hệ thống, đội tạo đơn, kế toán/kinh
 * doanh tổng hợp) cũng có `manageScope: 'company'` nhưng vì quyền module
 * khác, không phải vì họ quản phòng ban nào.
 */
export function departmentDetailFor(id: string): DepartmentDetail | null {
  const department = departments.find((d) => d.id === id);
  if (!department) return null;

  const listed = mockUsers.filter(
    (u) =>
      u.role === "deputy-director" &&
      u.manageScope === "listed" &&
      u.managedDepartmentIds.includes(id),
  );

  // Không ai ở cấp Phó GĐ quản — Giám đốc dùng `company`, không liệt kê
  // từng phòng (quyết định #44) nên không tự nhiên nằm trong danh sách trên.
  const managedByDefault = listed.length === 0;
  const managerSource = managedByDefault
    ? mockUsers.filter((u) => u.role === "director")
    : listed;

  return {
    department: { ...department, headcount: headcountOf(id) },
    managers: managerSource.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      title: u.title,
    })),
    managedByDefault,
  };
}
```

- [ ] **Step 3: Đăng ký route trong `src/mocks/handlers.ts`**

Đổi import từ:

```ts
import {
  createDepartment,
  departmentsFor,
  setDepartmentActive,
  updateDepartment,
} from "./org";
```

thành:

```ts
import {
  createDepartment,
  departmentDetailFor,
  departmentsFor,
  setDepartmentActive,
  updateDepartment,
} from "./org";
```

Chèn route mới ngay sau khối `http.get("/api/org/departments", ...)` (trước
`http.post("/api/org/departments", ...)`):

```ts
  http.get("/api/org/departments/:id", ({ params }) => {
    const detail = departmentDetailFor(String(params.id));
    return detail
      ? HttpResponse.json(detail)
      : new HttpResponse(null, { status: 404 });
  }),
```

- [ ] **Step 4: Kiểm kiểu**

Run: `bunx tsc --noEmit`
Expected: không có lỗi liên quan tới `src/lib/api/org.ts`, `src/mocks/org.ts`,
`src/mocks/handlers.ts`. Route mock chưa có trang nào gọi tới nên chưa kiểm
runtime được ở bước này — việc đó nằm ở Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/org.ts src/mocks/org.ts src/mocks/handlers.ts
git commit -m "Thêm endpoint chi tiết phòng ban: người quản lý cấp Phó GĐ/GĐ"
```

---

### Task 2: Trang chi tiết phòng ban

**Files:**
- Create: `src/app/(app)/departments/[id]/page.tsx`
- Create: `src/app/(app)/departments/[id]/page.module.css`

**Interfaces:**
- Consumes: `fetchDepartmentDetail(id: string): Promise<DepartmentDetail>` và type
  `DepartmentDetail` (Task 1, `@/lib/api/org`); `fetchStaff(query: StaffQuery): Promise<StaffList>`
  và type `StaffAccount` (`@/lib/api/staff`, đã có sẵn — không đổi); `ROLE_LABEL: Record<RoleKey,string>`
  và type `RoleKey` (`@/lib/types`); component `TopBar({ title, children? })`,
  `SectionCard({ title, icon?, meta?, children })`, `StatusTag({ ok, children })`,
  `RankTable<T>({ rows, columns, rowKey, defaultSort, caption, pageSize? })` (đều có sẵn)
- Produces: route `/departments/[id]`, class CSS `.nameLink` dùng chung cho link trong
  danh sách người quản lý và bảng nhân viên (khác namespace với `.nameLink` ở
  `departments/page.module.css` — mỗi module CSS độc lập)

- [ ] **Step 1: Viết `src/app/(app)/departments/[id]/page.module.css`**

```css
.body {
  flex: 1;
  padding: 22px 28px 40px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.back {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 13px;
  color: var(--om-text-2);
  padding: 12px 4px;
  margin: -12px 0;
}

.back:hover {
  color: var(--om-orange-mid);
  text-decoration: underline;
}

.nameLink {
  display: block;
  padding: 12px 0;
  margin: -12px 0;
  color: var(--om-text);
}

.nameLink:hover {
  color: var(--om-orange-mid);
  text-decoration: underline;
}

.managers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.managers li {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.managerTitle {
  font-size: 12.5px;
  color: var(--om-text-2);
}

.footnote {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--color-neutral-600);
}

@media (max-width: 900px) {
  .body {
    padding: 16px 16px 32px;
  }
}
```

- [ ] **Step 2: Viết `src/app/(app)/departments/[id]/page.tsx`**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";
import { ChevronLeft, UserCog, Users } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { fetchDepartmentDetail } from "@/lib/api/org";
import { fetchStaff, type StaffAccount } from "@/lib/api/staff";
import { ROLE_LABEL, type RoleKey } from "@/lib/types";
import styles from "./page.module.css";

/** Trưởng/Phó phòng sắp lên đầu bảng nhân viên — số càng cao càng lên trước. */
const ROLE_RANK: Record<RoleKey, number> = {
  head: 2,
  "deputy-head": 1,
  staff: 0,
  "deputy-director": 0,
  director: 0,
};

const EMPLOYEE_COLUMNS: RankColumn<StaffAccount>[] = [
  {
    key: "fullName",
    label: "Tên",
    render: (s) => (
      <Link href={`/people/${s.id}`} className={styles.nameLink}>
        {s.fullName}
      </Link>
    ),
  },
  {
    key: "role",
    label: "Chức vụ",
    sortBy: (s) => ROLE_RANK[s.role],
    render: (s) => ROLE_LABEL[s.role],
  },
  {
    key: "active",
    label: "Trạng thái",
    render: (s) => (
      <StatusTag ok={s.active}>{s.active ? "Đang hoạt động" : "Đã khoá"}</StatusTag>
    ),
  },
];

/** Chi tiết một phòng ban — mở rộng P-91: bấm tên phòng ở bảng đi tới đây. */
export default function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data, isPending, isError } = useQuery({
    queryKey: ["org-department", id],
    queryFn: () => fetchDepartmentDetail(id),
  });

  const { data: staffData } = useQuery({
    queryKey: ["staff-by-department", id],
    queryFn: () =>
      fetchStaff({
        departmentId: id,
        status: "all",
        roles: [],
        search: "",
        scope: "company",
      }),
    enabled: Boolean(data),
  });

  const employees = staffData?.staff ?? [];

  return (
    <>
      <TopBar title={data?.department.name ?? "Phòng ban"} />

      <main className={styles.body}>
        <Link href="/departments" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Phòng ban
        </Link>

        {isPending && <p className="text-muted">Đang tải phòng ban…</p>}
        {isError && <p className="text-muted">Không tìm thấy phòng ban này.</p>}

        {data && (
          <>
            <SectionCard title="Người quản lý" icon={<UserCog size={17} />}>
              <ul className={styles.managers}>
                {data.managers.map((m) => (
                  <li key={m.id}>
                    <Link href={`/people/${m.id}`} className={styles.nameLink}>
                      {m.fullName}
                    </Link>
                    <span className={styles.managerTitle}>{m.title}</span>
                  </li>
                ))}
              </ul>
              {data.managedByDefault && (
                <p className={styles.footnote}>
                  Phòng này chưa có Phó Giám Đốc phụ trách — Giám đốc quản trực tiếp.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Nhân viên"
              icon={<Users size={17} />}
              meta={`${employees.length} người`}
            >
              {employees.length === 0 ? (
                <p className="text-muted">Phòng này chưa có nhân viên nào.</p>
              ) : (
                <RankTable
                  rows={employees}
                  columns={EMPLOYEE_COLUMNS}
                  rowKey={(s) => s.id}
                  defaultSort="role"
                  pageSize={10}
                  caption="Nhân viên của phòng, Trưởng và Phó phòng nằm đầu bảng"
                />
              )}
              <p className={styles.footnote}>
                Gồm cả người <strong>đã khoá</strong> — họ vẫn thuộc phòng này cho tới
                khi chuyển sang phòng khác.
              </p>
            </SectionCard>
          </>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 3: Kiểm kiểu và lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: sạch, không lỗi mới.

- [ ] **Step 4: Lái thử qua trình duyệt**

Chạy `bun run dev`, đăng nhập `giamdoc` / `12345678`, mở thẳng URL
`http://localhost:3100/departments/kd-2` (hoặc cổng dev đang chạy):

- Mục **Người quản lý** hiện đúng **Nguyễn Thị Hồng Huệ · Phó Giám Đốc 2** —
  KHÔNG hiện Trưởng phòng KD2 ở mục này
- Bảng **Nhân viên** có dòng **Trần Văn Hậu** (Trưởng phòng Kinh doanh 2) nằm
  **đầu bảng**
- Bấm tên một nhân viên bất kỳ trong bảng → mở đúng hồ sơ `/people/:id` của người đó
- Mở tiếp `http://localhost:3100/departments/an-sinh` (hoặc id thật của Phòng An
  Sinh, tra trong `src/mocks/data.ts`) → mục Người quản lý hiện **Đinh Hoàng
  Công · Giám đốc**, kèm câu giải thích không có Phó GĐ phụ trách
- Mở `http://localhost:3100/departments/khong-ton-tai` → hiện "Không tìm thấy
  phòng ban này", không crash trắng trang

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/departments/[id]"
git commit -m "Thêm trang chi tiết phòng ban: người quản lý + danh sách nhân viên"
```

---

### Task 3: Nối từ bảng P-91 sang trang chi tiết

**Files:**
- Modify: `src/app/(app)/departments/page.tsx`
- Modify: `src/app/(app)/departments/page.module.css`

**Interfaces:**
- Consumes: route `/departments/[id]` (Task 2)
- Produces: cột "Tên phòng" ở bảng P-91 là link, không đổi kiểu dữ liệu nào khác

- [ ] **Step 1: Thêm `.nameLink` vào `src/app/(app)/departments/page.module.css`**

Thêm vào cuối file (trước media query `@media (max-width: 900px)` hoặc sau `.footnote`,
miễn không nằm trong khối media query có sẵn):

```css
.nameLink {
  display: block;
  padding: 12px 0;
  margin: -12px 0;
  color: var(--om-text);
}

.nameLink:hover {
  color: var(--om-orange-mid);
  text-decoration: underline;
}
```

- [ ] **Step 2: Đổi cột "Tên phòng" thành link trong `src/app/(app)/departments/page.tsx`**

Thêm import `Link` từ `next/link` vào đầu file (cạnh các import khác):

```tsx
import Link from "next/link";
```

Đổi:

```tsx
      { key: "name", label: "Tên phòng", render: (d) => d.name },
```

thành:

```tsx
      {
        key: "name",
        label: "Tên phòng",
        render: (d) => (
          <Link href={`/departments/${d.id}`} className={styles.nameLink}>
            {d.name}
          </Link>
        ),
      },
```

- [ ] **Step 3: Kiểm kiểu và lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: sạch, không lỗi mới.

- [ ] **Step 4: Lái thử toàn bộ luồng theo mục Xác minh của spec**

Chạy `bun run dev`, đăng nhập `giamdoc` / `12345678`:

- Vào **Phòng ban** ở sidebar → bảng hiện, cột Tên phòng có gạch chân khi rê chuột
- Bấm tên **Phòng Kinh doanh 2** → sang `/departments/kd-2`, đúng Task 2 Step 4
- Bấm **← Phòng ban** ở trang chi tiết → quay lại đúng bảng P-91
- Bấm tên **Phòng An Sinh** → thấy fallback Giám đốc
- Đăng nhập `tpkd2` (không có `manage-org`) → sidebar không có mục Phòng ban,
  nhưng vào thẳng URL `/departments/kd-2` vẫn xem được (đúng hành vi hiện tại
  của P-91 — chỉ ẩn nav, không chặn xem)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/departments/page.tsx" "src/app/(app)/departments/page.module.css"
git commit -m "Nối tên phòng ở bảng P-91 sang trang chi tiết"
```
