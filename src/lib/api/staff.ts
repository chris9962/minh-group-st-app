import { z } from 'zod';
import { ManageScope, Permission, ROLE_LABEL, RoleKey } from '@/lib/types';
import { pageOf, pageParams, type PageQuery } from './pagination';

/** Hồ sơ nhân viên = tài khoản đăng nhập. Một thứ, không tách (spec §2.2). */

export const StaffAccount = z.object({
  id: z.string(),
  fullName: z.string(),
  username: z.string(),
  /** Mã nhân viên — định danh ở app khác của công ty. null với tài khoản cũ chưa bổ sung. */
  staffCode: z.string().nullable(),
  phone: z.string(),
  /** THUỘC VỀ — đúng một phòng. Rỗng với ban giám đốc. */
  departmentId: z.string().nullable(),
  departmentName: z.string(),
  /** Bắt buộc. Biểu mẫu tạo người luôn có sẵn một chức vụ nên không có ai thiếu. */
  role: RoleKey,
  title: z.string(),
  manageScope: ManageScope,
  managedDepartmentIds: z.array(z.string()),
  /**
   * Ngân hàng được giao — CHỈ ĐỌC ở màn nhân sự. Muốn đổi thì sang hộp thoại
   * sửa ngân hàng: câu hỏi ở đó là "ngân hàng này ai quản", và một ngân hàng
   * có nhiều người quản nên sửa từ phía ngân hàng mới nhìn đủ.
   */
  managedBankIds: z.array(z.string()),
  active: z.boolean(),
  /**
   * Quyền THẬT của người này — mặc định theo Chức vụ lúc tạo, admin gán tay
   * đè lên được (mục 1.1.0 spec). Đây là nguồn hiển thị ở P-92/thẻ "Quyền" —
   * không suy ngược từ `role`, vì suy ngược thì mất phần admin đã cấp thêm.
   */
  permissions: z.array(Permission),
});
export type StaffAccount = z.infer<typeof StaffAccount>;

/**
 * Một dòng của bảng P-51: hồ sơ nhân viên + ô chỉ tiêu.
 *
 * Điểm và mốc đi kèm ngay trong dòng vì bảng cho SẮP theo tỉ lệ đạt — máy chủ
 * phải tự tính lấy thì mới cắt đúng trang (AGENTS.md §5.1, điều 3).
 */
export const StaffRow = StaffAccount.extend({
  /** Điểm tháng, đã làm tròn. Chưa có bản ghi nào thì bằng 0 thật. */
  points: z.number(),
  /** Mốc của đúng phòng người này. */
  target: z.number(),
  /**
   * Ba số đếm của ĐÚNG tháng đang xem, gộp theo người tạo.
   *
   * Chỉ để hiện, KHÔNG sắp được — `STAFF_SORT` cố ý không nhận chúng. Sắp theo
   * số đếm buộc máy chủ phải biết số của mọi người TRƯỚC khi cắt trang, tức
   * gộp cả kho tài khoản mỗi lần gõ phím (AGENTS.md §5.2). Cần sắp thì phải
   * chuyển sang cột đếm do trigger giữ, kèm đủ 5 điều kiện của db-design §9.
   */
  customers: z.number(),
  accounts: z.number(),
  services: z.number(),
  /**
   * Điểm KPI trong ĐÚNG KHOẢNG NGÀY đang xem — `null` khi nơi gọi không gửi
   * `from`/`to` (màn P-51 dùng cột `points` theo tháng).
   *
   * Khác `points`: cột đó đọc `kpi_scores`, mà bảng ấy lưu theo THÁNG. Màn chi
   * tiết phòng ban xem theo khoảng ngày nên phải có số của đúng khoảng đó, nếu
   * không thì cột điểm nói chuyện tháng còn ba cột đếm nói chuyện tuần.
   *
   * ⚠️ Gom theo NGƯỜI LẬP HỒ SƠ KHÁCH, khác ba cột đếm — chúng đếm theo người
   * tạo bản ghi (thể lệ câu 7.11).
   */
  rangePoints: z.number().nullable().default(null),
});
export type StaffRow = z.infer<typeof StaffRow>;

export const StaffSummary = z.object({
  active: z.number(),
  locked: z.number(),
  onTarget: z.number(),
  offTarget: z.number(),
});
export type StaffSummary = z.infer<typeof StaffSummary>;

export const StaffList = z.object({
  /** Tháng của phần tóm tắt. Luôn là tháng, kể cả khi bảng đang xem theo ngày. */
  summaryMonth: z.string(),
  /** Số ngày còn lại của tháng. 0 nếu không phải tháng hiện tại. */
  daysLeft: z.number(),
  /** Đếm trên PHẠM VI + ĐƠN VỊ, cố ý bỏ qua tìm kiếm / trạng thái / chức vụ. */
  summary: StaffSummary,
  /**
   * Tổng điểm của CẢ PHÒNG trong khoảng ngày đang xem — `null` khi nơi gọi
   * không lọc theo một phòng, hoặc không gửi `from`/`to`.
   *
   * Cộng trên TOÀN phòng chứ không phải trên trang đang xem: bảng cắt 15 dòng
   * một trang, cộng theo trang thì mỗi lần bấm sang trang lại ra một tổng khác.
   */
  departmentPoints: z.number().nullable().default(null),
  page: pageOf(StaffRow),
});
export type StaffList = z.infer<typeof StaffList>;

export const isOnTarget = (r: { points: number; target: number }) => r.points >= r.target;
export const pointsGap = (r: { points: number; target: number }) => r.points - r.target;

/**
 * Ba khoá sắp, và chỉ ba — khoá đi thẳng vào `ORDER BY` nên phải qua danh sách
 * trắng (AGENTS.md §5.1, điều 2).
 */
export const STAFF_SORT = ['name', 'role', 'kpi'] as const;
export type StaffSort = (typeof STAFF_SORT)[number];

/**
 * Chức vụ quyết định luôn hai trục tổ chức, không để người tạo tự tích.
 *
 * `phòng phụ trách` là chữ của spec §1.1.2 cho phạm vi NHÌN, không phải chức
 * trách quản lý: spec ghi rõ "trưởng phòng là 1 phòng" — đúng phòng họ thuộc
 * về. Để người tạo tích tay thì họ bỏ trống, và `recordVisibility` trả `none`
 * khi danh sách rỗng: người mới lập thấy 0 bản ghi, kể cả bản ghi của chính
 * mình. Hai tài khoản thật đã rơi vào đó.
 */
export const ROLE_SHAPE: Record<
  RoleKey,
  { department: boolean; manages: 'company' | 'own-department' | 'listed' | 'none' | 'free' }
> = {
  director: { department: false, manages: 'company' },
  'deputy-director': { department: false, manages: 'listed' },
  head: { department: true, manages: 'own-department' },
  'deputy-head': { department: true, manages: 'own-department' },
  // Chức vụ Nhân viên CỐ Ý không siết — chốt 12/08. Bốn chức vụ trên là chỗ
  // đứng trong cây tổ chức nên suy ra được; Nhân viên thì không. `admin` là
  // tài khoản kỹ thuật giữ `cấp quyền`, không thuộc phòng nào, và phải giữ
  // nguyên như vậy. Siết theo bảng thì chính nó không lưu nổi hồ sơ của mình.
  staff: { department: true, manages: 'free' },
};

/**
 * Dựng lại hai trục tổ chức từ chức vụ + đơn vị. Biểu mẫu gọi hàm này ngay
 * trước khi gửi, nên người dùng không bao giờ gặp lỗi của `superRefine` dưới
 * đây — lỗi đó dành cho ai gọi thẳng API.
 */
export function normalizeStaffForm(form: StaffForm): StaffForm {
  const shape = ROLE_SHAPE[form.role];
  if (shape.manages === 'free') return form;
  const departmentId = shape.department ? form.departmentId : '';
  const managedDepartmentIds =
    shape.manages === 'own-department'
      ? departmentId
        ? [departmentId]
        : []
      : shape.manages === 'listed'
        ? form.managedDepartmentIds
        : [];
  const manageScope =
    shape.manages === 'company' ? 'company' : shape.manages === 'none' ? 'none' : 'listed';
  return { ...form, departmentId, manageScope, managedDepartmentIds };
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Biểu mẫu tạo / sửa nhân viên.
 *
 * Không có `.default()` — zod v4 làm kiểu vào/ra lệch nhau và react-hook-form
 * báo lỗi kiểu. Giá trị mặc định đặt ở `defaultValues`.
 */
export const StaffForm = z.object({
  fullName: z.string().trim().min(2, 'Chưa nhập họ tên'),
  username: z
    .string()
    .trim()
    .min(3, 'Tên đăng nhập ít nhất 3 ký tự')
    .regex(/^[a-z0-9._-]+$/, 'Chỉ dùng chữ thường không dấu, số và . _ -'),
  /** Bắt buộc trên form — định danh nhân viên ở app khác, không được trùng. */
  staffCode: z.string().trim().min(1, 'Chưa nhập mã nhân viên'),
  phone: z
    .string()
    .trim()
    .regex(/^0\d{9}$/, 'Số điện thoại phải đủ 10 số và bắt đầu bằng 0'),
  /**
   * Chuỗi rỗng = không thuộc phòng nào, đúng với ban giám đốc.
   *
   * Bắt dạng uuid ngay ở đây: để lọt chuỗi bậy xuống Postgres là `22P02`, mà
   * tầng dưới chỉ bắt `23505` nên client nhận 500 thay vì 400.
   */
  departmentId: z.union([z.literal(''), z.guid()]),
  role: RoleKey,
  title: z.string().trim().min(2, 'Chưa nhập chức danh'),
  manageScope: ManageScope,
  managedDepartmentIds: z.array(z.guid()),
  /*
    KHÔNG có `bankScope` lẫn `managedBankIds` ở đây (chốt 2026-08-24).

    Phạm vi ngân hàng nay đọc từ QUYỀN — `manage-bank` là mọi ngân hàng,
    `manage-assigned-banks` là danh sách được giao — nên nó đi qua trần
    `checkPermissions` như mọi quyền khác. Bản trước có một trường riêng mà
    `checkCeilings` không kiểm, và người dùng tự nâng phạm vi của chính mình được.

    Danh sách ngân hàng gán ở hộp thoại sửa ngân hàng: câu hỏi lúc đó là "ngân
    hàng này ai quản", và một ngân hàng có nhiều người quản.
  */
  permissions: z.array(Permission),
}).superRefine((form, ctx) => {
  const shape = ROLE_SHAPE[form.role];
  if (shape.manages === 'free') return;
  const label = ROLE_LABEL[form.role];
  const fail = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });

  if (shape.department && !form.departmentId) fail('departmentId', `${label} phải thuộc một đơn vị`);
  if (!shape.department && form.departmentId) fail('departmentId', `${label} không thuộc đơn vị nào`);

  const expected = normalizeStaffForm(form);
  if (form.manageScope !== expected.manageScope)
    fail('manageScope', `${label} không đặt được mức quản lý này`);

  if (shape.manages === 'own-department' && !sameIds(form.managedDepartmentIds, expected.managedDepartmentIds))
    fail('managedDepartmentIds', `${label} phụ trách đúng đơn vị mình thuộc về`);
  if (shape.manages === 'listed' && form.managedDepartmentIds.length === 0)
    fail('managedDepartmentIds', 'Chọn ít nhất một phòng phụ trách');
  if ((shape.manages === 'none' || shape.manages === 'company') && form.managedDepartmentIds.length > 0)
    fail('managedDepartmentIds', `${label} không phụ trách phòng nào`);
});
export type StaffForm = z.infer<typeof StaffForm>;

export const SAVE_ERROR = {
  USERNAME_TAKEN: 'username-taken',
  STAFF_CODE_TAKEN: 'staff-code-taken',
  ROLE_TOO_HIGH: 'role-too-high',
  PERMISSION_TOO_HIGH: 'permission-too-high',
  /** Giao phòng mình không quản cho người khác — cũng là một dạng nới phạm vi. */
  MANAGED_DEPARTMENT_TOO_WIDE: 'managed-department-too-wide',
} as const;

export const SaveError = z.object({
  code: z.enum([
    SAVE_ERROR.USERNAME_TAKEN,
    SAVE_ERROR.STAFF_CODE_TAKEN,
    SAVE_ERROR.ROLE_TOO_HIGH,
    SAVE_ERROR.PERMISSION_TOO_HIGH,
    SAVE_ERROR.MANAGED_DEPARTMENT_TOO_WIDE,
  ]),
  message: z.string(),
});
export type SaveError = z.infer<typeof SaveError>;

export type StaffQuery = PageQuery<StaffSort> & {
  scope: string;
  departmentId: string;
  search: string;
  /** Tháng chấm điểm. Rỗng = tháng làm việc hiện tại. */
  summaryMonth: string;
  /**
   * Khoảng ngày của BA CỘT ĐẾM, dạng `YYYY-MM-DD`. Cùng cặp tham số với route
   * ngân hàng, bảo hiểm, dịch vụ và khách hàng.
   *
   * Thiếu một trong hai thì ba cột đếm theo `summaryMonth` — hai trục thời gian
   * trùng nhau, đó là màn P-51.
   *
   * Tách hai trục là cố ý: cột Chỉ tiêu buộc theo tháng vì `kpi_scores` lưu
   * theo tháng, còn ba cột đếm thì đếm dòng nên nhận được khoảng bất kỳ. Màn
   * chi tiết phòng ban gửi khoảng ngày và bỏ hẳn cột Chỉ tiêu.
   */
  from: string;
  to: string;
  /** `all` gồm cả người đã khoá. Mặc định chỉ hiện người đang làm. */
  status: 'active' | 'locked' | 'all';
  /** Chức vụ cần lấy. RỖNG nghĩa là lấy hết — không phải "không lấy gì". */
  roles: RoleKey[];
};

/**
 * Danh sách nhân viên RÚT GỌN, trọn bộ — cho ô tra cứu id → tên ở thanh lọc.
 *
 * Bảng "Nhân viên" của trang chi tiết phòng ban từng dùng nó; từ 2026-08-14 nó
 * gọi `fetchStaff` để có ba cột đếm và phân trang máy chủ.
 *
 * Route riêng chứ không phải tham số "lấy hết" trên route đã phân trang
 * (AGENTS.md §5.1, điều 4): mở đường đó một lần thì màn sau nào cũng lách.
 * Payload cố ý mỏng: đủ để tra cứu và hiện tên, KHÔNG kèm bảng quyền.
 */
export const StaffOption = z.object({
  id: z.string(),
  fullName: z.string(),
  username: z.string(),
  staffCode: z.string().nullable(),
  phone: z.string(),
  departmentName: z.string(),
  role: RoleKey,
  title: z.string(),
  active: z.boolean(),
});
export type StaffOption = z.infer<typeof StaffOption>;

export async function fetchStaffOptions(
  query: { departmentId?: string; status?: 'active' | 'all' } = {},
): Promise<StaffOption[]> {
  const params = new URLSearchParams();
  if (query.departmentId) params.set('departmentId', query.departmentId);
  if (query.status) params.set('status', query.status);
  const res = await fetch(`/api/staff/options?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách nhân viên');
  return z.array(StaffOption).parse(await res.json());
}

export async function fetchStaff(query: StaffQuery): Promise<StaffList> {
  const params = pageParams(query, {
    scope: query.scope,
    departmentId: query.departmentId,
    search: query.search,
    summaryMonth: query.summaryMonth,
    from: query.from,
    to: query.to,
    status: query.status,
    roles: query.roles.join(','),
  });
  const res = await fetch(`/api/staff?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách nhân viên');
  return StaffList.parse(await res.json());
}

/**
 * TRỌN danh sách nhân viên của MỘT phòng, KHÔNG phân trang (chốt 2026-09-03).
 *
 * Route riêng chứ không phải tham số "lấy hết" của `/api/staff` (AGENTS.md §5.1
 * điều 4) — đường đó mở ra một lần là mọi màn sau đều lách qua nó.
 *
 * Ngoại lệ có chủ đích của §5.1, hai lý do:
 *
 * 1. Một phòng nhiều nhất vài chục người. Phòng lớn nhất có 30, đo trên
 *    production 2026-09-03, và số này lớn theo tuyển dụng chứ không theo ngày
 *    làm việc.
 * 2. Ba cột đếm và cột Điểm KHÔNG sắp được trong SQL: ba cột đếm nằm ở bảng
 *    khác, còn điểm do hàm luật ở `src/rules/` tính. Sắp theo chúng ở máy chủ
 *    buộc phải tính cho cả phòng TRƯỚC khi cắt trang — đúng bằng phần việc của
 *    bản không cắt trang, cộng thêm một tầng phức tạp.
 *
 * Trình duyệt nhận đủ dòng rồi tự sắp. Phòng nào vượt trần của route thì
 * `total` lớn hơn `page.rows.length`, và lúc đó trang phải quay lại phân trang.
 */
export async function fetchDepartmentStaff(
  departmentId: string,
  range: { from: string; to: string },
): Promise<StaffList> {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  const res = await fetch(`/api/org/departments/${departmentId}/staff?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách nhân viên của phòng');
  return StaffList.parse(await res.json());
}

/** Dùng ở P-52 (hồ sơ một người) để hiện khối "Quyền" — P-51 chỉ trả danh sách rút gọn. */
export async function fetchStaffMember(id: string): Promise<StaffAccount> {
  const res = await fetch(`/api/staff/${id}`);
  if (!res.ok) throw new Error('Không tải được hồ sơ nhân viên này');
  return StaffAccount.parse(await res.json());
}

/** Lỗi nghiệp vụ ném ra dạng SaveError để form gắn được vào đúng ô nhập. */
async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = SaveError.safeParse(await res.json().catch(() => null));
    throw parsed.success ? parsed.data : new Error('Không lưu được');
  }
  return res.json();
}

/**
 * Hồ sơ vừa lập, kèm mật khẩu khởi tạo dạng chữ.
 *
 * Chỉ lượt tạo có `password`. Database giữ bản băm một chiều nên không route
 * nào đọc lại được — bỏ lỡ lần này thì phải bấm "Đặt lại mật khẩu" ở hồ sơ
 * người đó, và mật khẩu cũ mất hiệu lực.
 */
export const StaffCreated = StaffAccount.extend({ password: z.string() });
export type StaffCreated = z.infer<typeof StaffCreated>;

export const createStaff = (form: StaffForm, actorId: string) =>
  send('/api/staff', 'POST', { ...form, actorId }).then(StaffCreated.parse);

export const updateStaff = (id: string, form: StaffForm, actorId: string) =>
  send(`/api/staff/${id}`, 'PATCH', { ...form, actorId }).then(StaffAccount.parse);

export const setStaffActive = (id: string, active: boolean, actorId: string) =>
  send(`/api/staff/${id}/active`, 'POST', { active, actorId }).then(StaffAccount.parse);

/**
 * Sinh mật khẩu MỚI và trả về đúng một lần.
 *
 * Không có đường nào đọc lại mật khẩu cũ — nó lưu dạng băm một chiều. Muốn xem
 * lại được thì phải lưu dạng đọc được, và khi đó ai lấy được bản sao dữ liệu là
 * có mật khẩu của cả công ty.
 */
export const resetPassword = (id: string): Promise<{ password: string }> =>
  send(`/api/staff/${id}/reset-password`, 'POST').then((r) =>
    z.object({ password: z.string() }).parse(r),
  );
