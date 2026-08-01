import type { StaffAccount, StaffForm, StaffList, StaffQuery } from "@/lib/api/staff";
import { matchesSearch } from "@/lib/format";
import { assignableRoles, canGrant } from "@/lib/permissions";
import { ROLE_PERMISSIONS } from "@/lib/roles";
import type { User } from "@/lib/types";
import { logAudit } from "./auditLog";
import { departments, mockUsers, setMockUserPermissions } from "./data";
import { ALL } from "./people";

/**
 * Kho nhân viên cho P-51 · P-52 · P-53.
 *
 * Giữ trong bộ nhớ và SỬA ĐƯỢC — tạo/sửa/khoá phải thấy kết quả ngay, nếu
 * không thì không kiểm được luồng. Tải lại trang là về trạng thái đầu.
 */

const departmentName = (id: string | null): string =>
  departments.find((d) => d.id === id)?.name ?? "";

/** Gộp hai nguồn: tài khoản đăng nhập thật + danh sách người có điểm ở P-51. */
const fromMockUser = (u: User): StaffAccount => ({
  id: u.id,
  fullName: u.fullName,
  username: u.username,
  phone: "0900000000",
  departmentId: u.departmentId,
  departmentName: departmentName(u.departmentId),
  role: u.role,
  title: u.title,
  manageScope: u.manageScope,
  managedDepartmentIds: u.managedDepartmentIds,
  wardId: u.wardId,
  active: u.active,
  permissions: u.permissions,
});

const departmentIdByName = (name: string): string | null =>
  departments.find((d) => d.name === name)?.id ?? null;

/**
 * MỘT không gian id duy nhất.
 *
 * Người có mặt ở cả hai nguồn — vừa là tài khoản đăng nhập, vừa là người có
 * điểm ở P-51 — phải giữ id của bên P-51. Trước đây mỗi bên một id nên hồ sơ
 * `/people/p2` không tìm thấy tài khoản nào và thẻ Tài khoản lặng lẽ mất.
 */
let store: StaffAccount[] = [
  ...ALL.map((p, i): StaffAccount => {
    const account = mockUsers.find((u) => u.fullName === p.fullName);
    if (account) return { ...fromMockUser(account), id: p.id };
    return {
      id: p.id,
      fullName: p.fullName,
      username: `nv${String(i + 1).padStart(2, "0")}`,
      phone: "0900000000",
      departmentId: departmentIdByName(p.departmentName),
      departmentName: p.departmentName,
      role: "staff",
      title: "Nhân viên kinh doanh",
      manageScope: "none",
      managedDepartmentIds: [],
      wardId: null,
      active: i % 7 !== 0,
      // Người giả lập cho P-51, không phải tài khoản đăng nhập thật — hiện
      // đúng bó quyền mặc định của "Nhân viên" để khối "Quyền" ở P-52 không
      // trống trơn.
      permissions: ROLE_PERMISSIONS.staff,
    };
  }),
  // Tài khoản không có mặt ở P-51: ban giám đốc, kế toán, quản trị hệ thống.
  ...mockUsers
    .filter((u) => !ALL.some((p) => p.fullName === u.fullName))
    .map(fromMockUser),
];

let nextId = 1;

export function staffFor(query: StaffQuery): StaffList {
  const byStatus = store.filter((s) =>
    query.status === "all" ? true : query.status === "active" ? s.active : !s.active,
  );

  const byDepartment = query.departmentId
    ? byStatus.filter((s) => s.departmentId === query.departmentId)
    : byStatus;

  // Rỗng nghĩa là lấy hết. Nếu hiểu thành "không lấy gì" thì lần đầu mở trang
  // bảng sẽ trống trơn.
  const byRole =
    query.roles.length > 0
      ? byDepartment.filter((s) => query.roles.includes(s.role))
      : byDepartment;

  // Tìm kiếm KHÔNG áp lên phần tóm tắt — cùng quy tắc với P-51.
  const found = query.search
    ? byRole.filter((s) =>
        matchesSearch(`${s.fullName} ${s.username} ${s.departmentName}`, query.search),
      )
    : byRole;

  const inDepartment = query.departmentId
    ? store.filter((s) => s.departmentId === query.departmentId)
    : store;

  return {
    summary: {
      active: inDepartment.filter((s) => s.active).length,
      locked: inDepartment.filter((s) => !s.active).length,
    },
    staff: found,
  };
}

export const findStaff = (id: string) => store.find((s) => s.id === id) ?? null;

/**
 * Số người đang thuộc một phòng — dùng cho P-91.
 *
 * Đếm cả người đã khoá: họ vẫn thuộc phòng này, nên cho phòng ngừng hoạt động
 * là vẫn bỏ rơi họ trong một phòng không còn chọn được.
 */
export const headcountOf = (departmentId: string): number =>
  store.filter((s) => s.departmentId === departmentId).length;

const toAccount = (id: string, form: StaffForm): StaffAccount => ({
  id,
  fullName: form.fullName,
  username: form.username,
  phone: form.phone,
  departmentId: form.departmentId || null,
  departmentName: departmentName(form.departmentId || null),
  role: form.role,
  title: form.title,
  manageScope: form.manageScope,
  managedDepartmentIds:
    form.manageScope === "listed" ? form.managedDepartmentIds : [],
  wardId: form.wardId || null,
  active: true,
  permissions: form.permissions,
});

export type SaveOutcome =
  | { ok: true; staff: StaffAccount }
  | { ok: false; code: "username-taken" | "role-too-high" | "permission-too-high" };

/**
 * Máy chủ PHẢI kiểm lại chức vụ được gán, không tin danh sách mà giao diện gửi
 * lên. Ẩn bớt lựa chọn trong ô chọn không phải là phân quyền.
 */
function checkRole(actor: User | null, form: StaffForm): boolean {
  return assignableRoles(actor).includes(form.role);
}

/** Không tin danh sách quyền client gửi lên — mỗi bộ ba phải nằm trong tầm actor được cấp (mục 1.1.0). */
function checkPermissions(actor: User | null, form: StaffForm): boolean {
  return form.permissions.every((perm) => canGrant(actor, perm));
}

/** Đồng bộ sang tài khoản đăng nhập thật nếu người này có mặt ở đó (mocks/data.ts). */
function syncLoginPermissions(form: StaffForm): void {
  setMockUserPermissions(form.username, form.permissions);
}

/** Không log được nếu không biết ai làm — tài khoản demo cụt (actor null) thì bỏ qua. */
function logStaffAction(actor: User | null, action: "create" | "update" | "delete", staff: StaffAccount): void {
  if (!actor) return;
  logAudit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorUsername: actor.username,
    module: "staff",
    action,
    targetLabel: `Nhân viên ${staff.fullName}`,
  });
}

export function createStaff(
  form: StaffForm,
  actor: User | null,
): SaveOutcome {
  if (store.some((s) => s.username === form.username))
    return { ok: false, code: "username-taken" };
  if (!checkRole(actor, form)) return { ok: false, code: "role-too-high" };
  if (!checkPermissions(actor, form)) return { ok: false, code: "permission-too-high" };

  const staff = toAccount(`new-${nextId++}`, form);
  store = [staff, ...store];
  syncLoginPermissions(form);
  logStaffAction(actor, "create", staff);
  return { ok: true, staff };
}

export function updateStaff(
  id: string,
  form: StaffForm,
  actor: User | null,
): SaveOutcome {
  const current = findStaff(id);
  if (!current) return { ok: false, code: "username-taken" };
  if (store.some((s) => s.username === form.username && s.id !== id))
    return { ok: false, code: "username-taken" };
  if (!checkRole(actor, form)) return { ok: false, code: "role-too-high" };
  if (!checkPermissions(actor, form)) return { ok: false, code: "permission-too-high" };

  // Giữ nguyên `active`: khoá / mở khoá đi bằng đường riêng, sửa hồ sơ mà vô
  // tình mở khoá một người đã nghỉ việc là chuyện không được xảy ra.
  const staff = { ...toAccount(id, form), active: current.active };
  store = store.map((s) => (s.id === id ? staff : s));
  syncLoginPermissions(form);
  logStaffAction(actor, "update", staff);
  return { ok: true, staff };
}

export function setStaffActive(id: string, active: boolean, actor: User | null): StaffAccount | null {
  const current = findStaff(id);
  if (!current) return null;
  const staff = { ...current, active };
  store = store.map((s) => (s.id === id ? staff : s));
  logStaffAction(actor, active ? "update" : "delete", staff);
  return staff;
}

/** Mật khẩu sinh ngẫu nhiên, bỏ các ký tự dễ đọc nhầm khi nhắn qua Zalo. */
export function newPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(
    { length: 10 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}
