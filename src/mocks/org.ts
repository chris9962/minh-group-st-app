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

/**
 * Kho tổ chức cho P-91.
 *
 * SỬA THẲNG vào mảng `departments` của `data.ts` chứ không giữ bản sao riêng:
 * `people.ts`, `dashboard.ts` và `staff.ts` đều tra tên phòng từ mảng đó. Giữ
 * hai kho thì lập phòng mới xong bảng nhân viên vẫn tra ra tên rỗng.
 */

let nextId = 1;

/** So tên bỏ dấu và không phân biệt hoa thường — "Phòng KD 1" với "phòng kd 1" là một. */
const sameName = (a: string, b: string): boolean =>
  removeDiacritics(a).trim().toLowerCase() === removeDiacritics(b).trim().toLowerCase();

export function departmentsFor(search: string): DepartmentList {
  const rows = departments.map((d) => ({ ...d, headcount: headcountOf(d.id) }));

  // Tìm kiếm KHÔNG áp lên phần tóm tắt — cùng quy tắc với P-51: gõ tên một phòng
  // không có nghĩa là công ty chỉ còn một phòng.
  const found = search ? rows.filter((d) => matchesSearch(d.name, search)) : rows;

  return {
    summary: {
      total: rows.length,
      active: rows.filter((d) => d.active).length,
      stopped: rows.filter((d) => !d.active).length,
    },
    departments: found,
  };
}

export type OrgOutcome =
  | { ok: true; department: DepartmentRow }
  | { ok: false; code: OrgErrorCode };

export function createDepartment(form: DepartmentForm): OrgOutcome {
  if (departments.some((d) => sameName(d.name, form.name)))
    return { ok: false, code: ORG_ERROR.NAME_TAKEN };

  const department = { id: `new-dept-${nextId++}`, name: form.name, active: true };
  departments.push(department);
  return { ok: true, department: { ...department, headcount: 0 } };
}

export function updateDepartment(id: string, form: DepartmentForm): OrgOutcome {
  const current = departments.find((d) => d.id === id);
  if (!current) return { ok: false, code: ORG_ERROR.NAME_TAKEN };
  if (departments.some((d) => d.id !== id && sameName(d.name, form.name)))
    return { ok: false, code: ORG_ERROR.NAME_TAKEN };

  // Giữ nguyên `active`: ngừng / mở lại đi bằng đường riêng, đổi tên mà vô tình
  // mở lại một phòng đã giải thể là chuyện không được xảy ra.
  current.name = form.name;
  return { ok: true, department: { ...current, headcount: headcountOf(id) } };
}

/**
 * Máy chủ PHẢI kiểm lại số người, không tin nút đã bị vô hiệu ở giao diện.
 * Vô hiệu nút không phải là phân quyền.
 */
export function setDepartmentActive(id: string, active: boolean): OrgOutcome | null {
  const current = departments.find((d) => d.id === id);
  if (!current) return null;

  // Chỉ chặn lúc NGỪNG. Mở lại thì không xét gì — phòng còn người càng phải mở được.
  if (!active && headcountOf(id) > 0) return { ok: false, code: ORG_ERROR.NOT_EMPTY };

  current.active = active;
  return { ok: true, department: { ...current, headcount: headcountOf(id) } };
}

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
