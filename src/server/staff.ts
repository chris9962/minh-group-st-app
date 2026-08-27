import { randomInt } from "node:crypto";
import { compare, hashSync } from "bcryptjs";
import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type {
  StaffAccount,
  StaffForm,
  StaffList,
  StaffOption,
  StaffQuery,
  StaffSort,
} from "@/lib/api/staff";
import { businessMonth, monthRange } from "@/lib/format";
import {
  assignableRoles,
  can,
  canActOn,
  canGrant,
  clampScope,
  inVisibleScope,
  visibleDepartmentIds,
} from "@/lib/permissions";
import {
  isRealIsoDate,
  SCOPELESS_ACTIONS,
  SCOPES,
  Scope,
  type Action,
  type User,
} from "@/lib/types";
import { forbidden, isUuid, notFound } from "./auth";
import { db, uniqueViolationOf } from "./db/client";
import {
  bankAccounts,
  customers,
  departments,
  insuranceOrders,
  kpiScores,
  services,
  sessions,
  userManagedBanks,
  userManagedDepartments,
  userPermissions,
  users,
} from "./db/schema";
import type { PageArgs } from "./pagination";
import {
  countsInRange,
  createdByEndOf,
  daysLeftOf,
  pointsExpr,
  roleRankExpr,
  staffSearchWhere,
  targetExpr,
} from "./people";
import { recomputeGiftCase } from "./gift";
import { relationsFor } from "./users";

/**
 * P-51 · P-52 · P-53 — bản DB của src/mocks/staff.ts, cùng luật nghiệp vụ:
 * máy chủ kiểm lại bậc vai + từng ô quyền, không tin danh sách giao diện gửi lên.
 */

/**
 * Ngày lọc phải ĐÚNG HÌNH DẠNG và CÓ THẬT.
 *
 * Cùng hàm với bốn module danh sách kia (mục M20). `2026-02-30` khớp hình dạng
 * `YYYY-MM-DD` nhưng tháng 2 không có ngày 30, và Postgres từ chối nó bằng
 * `22008` làm cả màn trả 500.
 *
 * Kiểm ở ĐÂY chứ không ở route: hàm này còn nơi gọi khác, và chặn một đầu thì
 * đầu kia vẫn vỡ. Ngày sai thì bỏ qua khoảng, rơi về tháng — không trả 400.
 */
const usableDate = isRealIsoDate;

type UserWithDepartment = typeof users.$inferSelect & { departmentName: string | null };

async function toAccounts(rows: UserWithDepartment[]): Promise<StaffAccount[]> {
  // Quyền + phòng quản + ngân hàng quản nạp MỘT lượt cho cả trang, không truy
  // vấn từng người (N+1).
  const { permissionsOf, managedOf, managedBanksOf } = await relationsFor(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    username: r.username,
    staffCode: r.staffCode,
    phone: r.phone,
    departmentId: r.departmentId,
    departmentName: r.departmentName ?? "",
    role: r.role,
    title: r.title,
    manageScope: r.manageScope,
    managedDepartmentIds: managedOf.get(r.id) ?? [],
    managedBankIds: managedBanksOf.get(r.id) ?? [],
    active: r.active,
    permissions: permissionsOf.get(r.id) ?? [],
  }));
}

/**
 * MỘT trang của bảng nhân sự P-51 — lọc, tìm, sắp, cắt trang và đếm tóm tắt đều
 * chạy trong SQL (AGENTS.md §5.1 · §5.2).
 *
 * Ba câu chính chỉ đụng hồ sơ nhân sự (`users` + tên phòng) và điểm/chỉ tiêu
 * (`kpi_scores` + `kpi_targets`) — không câu nào chạm bảng nghiệp vụ, nên lọc,
 * sắp và cắt trang không phụ thuộc kích thước kho.
 *
 * `countsInRange` ở cuối hàm CÓ đụng `customers`, `bank_accounts` và
 * `services`, nhưng chỉ cho 15 id đã cắt trang xong (§5.2 cách A). Ba bảng đó
 * đều có chỉ mục ghép `(created_by, ngày)` cho đúng hình dạng câu hỏi này.
 *
 * Bản cũ kéo 500 người rồi lọc bằng JS: người thứ 501 biến mất im lặng và thẻ
 * tóm tắt đếm thiếu theo, tức SAI SỐ chứ không phải chậm.
 */
export async function staffFor(
  actor: User,
  query: Omit<StaffQuery, "page" | "sort" | "dir">,
  page: PageArgs<StaffSort>,
): Promise<StaffList> {
  // Phạm vi client xin hạ về đúng mức thật của người gọi — không tin tham số URL.
  const requested = Scope.safeParse(query.scope);
  const scope = clampScope(actor, "staff", "view-detail", requested.success ? requested.data : null);
  const visible = visibleDepartmentIds(actor, scope);

  const summaryMonth = query.summaryMonth || businessMonth();
  const target = targetExpr(summaryMonth);
  const points = pointsExpr(summaryMonth);
  const daysLeft = daysLeftOf(summaryMonth);

  // null = không giới hạn phòng; [] = không thấy ai (người không thuộc phòng nào, phạm vi own).
  if (visible !== null && visible.length === 0)
    return {
      summaryMonth,
      daysLeft,
      summary: { active: 0, locked: 0, onTarget: 0, offTarget: 0 },
      page: { rows: [], total: 0 },
    };

  /**
   * Phạm vi + ô lọc đơn vị + mốc thời điểm. Thẻ tóm tắt đếm trên ĐÚNG tập này.
   *
   * `createdByEndOf` nằm ở đây chứ không ở `where`: thẻ tóm tắt cũng phải bỏ
   * người chưa có tài khoản trong tháng đang xem, nếu không thì thẻ "chưa đạt"
   * đếm cả họ.
   */
  const inScope = and(
    visible === null ? undefined : inArray(users.departmentId, visible),
    query.departmentId ? eq(users.departmentId, query.departmentId) : undefined,
    createdByEndOf(summaryMonth),
  );

  const where = and(
    inScope,
    query.status === "all" ? undefined : eq(users.active, query.status === "active"),
    // Rỗng nghĩa là lấy hết — hiểu thành "không lấy gì" thì lần đầu mở trang bảng trống trơn.
    query.roles.length > 0 ? inArray(users.role, query.roles) : undefined,
    staffSearchWhere(query.search),
  );

  const direction = page.dir === "asc" ? asc : desc;
  /**
   * Mọi kiểu sắp kết thúc bằng `id`. Trang 1 và trang 2 là hai câu hỏi riêng
   * biệt, không có khoá phụ duy nhất thì thứ tự giữa những dòng bằng nhau là
   * không xác định — người thứ 15 lần này thành thứ 16 lần sau, hiện lại ở
   * trang 2 còn người khác biến mất khỏi cả hai trang.
   */
  const orderBy = {
    // Sắp theo tên đã bỏ dấu: collate mặc định của Postgres xếp `Đặng` sau
    // `Zũng`, người dùng đọc ra là bảng sắp sai.
    name: [direction(sql`mgst_normalize(${users.fullName})`), asc(users.id)],
    // `roleRankExpr` chứ không phải cột `role`: enum khai `director` trước
    // `staff` nên Giám đốc mang số nhỏ nhất, và `DESC` trên cột đó đẩy Nhân
    // viên lên đầu trong khi mũi tên ↓ hứa điều ngược lại.
    role: [direction(roleRankExpr), asc(sql`mgst_normalize(${users.fullName})`), asc(users.id)],
    // Sắp theo TỈ LỆ đạt, không theo hiệu số: mốc mỗi phòng có thể khác nhau
    // nên "còn thiếu 10" của người mốc 50 nặng hơn của người mốc 200.
    kpi: [direction(sql`${points}::float / nullif(${target}, 0)`), asc(users.id)],
  }[page.sort] as SQL[];

  const [rows, [totals], [counts]] = await Promise.all([
    db
      .select({ user: users, departmentName: departments.name, points, target })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .leftJoin(
        kpiScores,
        and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, summaryMonth)),
      )
      .where(where)
      .orderBy(...orderBy)
      .limit(page.limit)
      .offset(page.offset),
    // Phép nối `departments` phải giữ ở câu đếm — ô tìm kiếm soi cả tên đơn vị.
    db
      .select({ value: count() })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(where),
    // Tóm tắt cố ý KHÔNG áp tìm kiếm / trạng thái / chức vụ: gõ tên một người
    // không có nghĩa công ty chỉ còn một người.
    db
      .select({
        active: sql<number>`count(*) filter (where ${users.active})::int`,
        locked: sql<number>`count(*) filter (where not ${users.active})::int`,
        // Chỉ người đang làm mới có chỉ tiêu. Tính cả tài khoản đã khoá thì họ
        // vào với 0 điểm và "chưa đạt" phồng lên mà không ai thấy vì sao.
        onTarget: sql<number>`count(*) filter (where ${users.active} and ${points} >= ${target})::int`,
      })
      .from(users)
      .leftJoin(
        kpiScores,
        and(eq(kpiScores.userId, users.id), eq(kpiScores.yearMonth, summaryMonth)),
      )
      .where(inScope),
  ]);

  const accounts = await toAccounts(
    rows.map((r) => ({ ...r.user, departmentName: r.departmentName })),
  );
  const scoreById = new Map(rows.map((r) => [r.user.id, r]));
  /**
   * Đếm SAU khi đã cắt trang, và chỉ cho id của trang này — xem `countsInRange`.
   *
   * Ba cột đếm và cột Chỉ tiêu chạy trên HAI trục thời gian khác nhau. Chỉ tiêu
   * buộc phải theo tháng vì `kpi_scores` lưu theo tháng; ba cột đếm thì đếm
   * dòng nên nhận được khoảng ngày bất kỳ. Thiếu `from`/`to` thì hai trục trùng
   * nhau — đó là màn P-51. Màn chi tiết phòng ban gửi khoảng ngày và bỏ hẳn
   * cột Chỉ tiêu, vì "chỉ tiêu của ngày 05/08 đến 12/08" không có nghĩa.
   */
  const countsById = await countsInRange(
    rows.map((r) => r.user.id),
    usableDate(query.from) && usableDate(query.to)
      ? { from: query.from, to: query.to }
      : monthRange(summaryMonth),
  );

  const active = counts?.active ?? 0;
  const onTarget = counts?.onTarget ?? 0;

  return {
    summaryMonth,
    daysLeft,
    summary: { active, locked: counts?.locked ?? 0, onTarget, offTarget: active - onTarget },
    page: {
      rows: accounts.map((a) => ({
        ...a,
        points: scoreById.get(a.id)?.points ?? 0,
        target: scoreById.get(a.id)?.target ?? 100,
        customers: countsById.get(a.id)?.customers ?? 0,
        accounts: countsById.get(a.id)?.accounts ?? 0,
        services: countsById.get(a.id)?.services ?? 0,
      })),
      total: totals?.value ?? 0,
    },
  };
}

/**
 * Danh sách rút gọn, trọn bộ trong phạm vi người gọi — cho ô CHỌN NGƯỜI ở
 * thanh lọc. Không phân trang vì ô chọn cần đủ danh sách để tra.
 *
 * Trang chi tiết phòng ban từng dùng hàm này; từ 2026-08-14 nó gọi `staffFor`
 * để có ba cột đếm và phân trang máy chủ.
 *
 * Payload mỏng có chủ đích: đủ để tra cứu và hiện tên, KHÔNG kèm bảng quyền —
 * thứ chỉ hồ sơ một người mới cần.
 */
export async function listStaffOptions(
  actor: User,
  query: { departmentId: string; status: "active" | "all" },
): Promise<StaffOption[]> {
  const scope = clampScope(actor, "staff", "view-detail", null);
  const visible = visibleDepartmentIds(actor, scope);
  if (visible !== null && visible.length === 0) return [];

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      staffCode: users.staffCode,
      phone: users.phone,
      departmentName: departments.name,
      role: users.role,
      title: users.title,
      active: users.active,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(
      and(
        visible === null ? undefined : inArray(users.departmentId, visible),
        query.departmentId ? eq(users.departmentId, query.departmentId) : undefined,
        query.status === "active" ? eq(users.active, true) : undefined,
      ),
    )
    .orderBy(asc(sql`mgst_normalize(${users.fullName})`), asc(users.id));

  return rows.map((r) => ({ ...r, departmentName: r.departmentName ?? "" }));
}

export async function findStaff(id: string): Promise<StaffAccount | null> {
  const rows = await db
    .select({ user: users, departmentName: departments.name })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(users.id, id))
    .limit(1);
  if (!rows[0]) return null;

  const [account] = await toAccounts([{ ...rows[0].user, departmentName: rows[0].departmentName }]);
  return account;
}

/**
 * Cổng chung cho MỌI thao tác lên một hồ sơ nhân viên cụ thể.
 *
 * Trước đây mỗi route tự gác một kiểu: `active` và `reset-password` gọi `can()`,
 * còn `GET`/`PATCH` thì không gác gì — nên một Phó GĐ sửa được cả tài khoản ở
 * phòng mình không quản, kể cả hạ cấp Giám đốc. Gom về một chỗ để không route
 * nào quên được nữa (AGENTS.md §6).
 *
 * Ba lớp, đúng thứ tự: có quyền trên module chưa → mục tiêu có nằm trong phạm
 * vi mình nhìn thấy không → mình có đủ bậc để đụng vào người này không.
 */
export async function staffTargetFor(
  actor: User,
  id: string,
  action: Action,
): Promise<{ ok: true; staff: StaffAccount } | { ok: false; response: Response }> {
  if (!isUuid(id)) return { ok: false, response: notFound() };
  if (!can(actor, "staff", action)) return { ok: false, response: forbidden() };

  const staff = await findStaff(id);
  if (!staff) return { ok: false, response: notFound() };

  // Ngoài tầm nhìn trả 404 y hệt "không tồn tại" — 403 là xác nhận id có thật.
  if (!inVisibleScope(actor, "staff", action, staff.departmentId))
    return { ok: false, response: notFound() };

  // Trần BẬC chỉ chặn thao tác GHI. Với lượt xem thì phạm vi đã đủ, thêm bậc nữa
  // là người ngang vai không mở nổi hồ sơ của nhau dù cùng phòng.
  if (action !== "view-detail" && !canActOn(actor, staff))
    return { ok: false, response: forbidden() };

  return { ok: true, staff };
}

type SaveErrorCode =
  | "username-taken"
  | "staff-code-taken"
  | "role-too-high"
  | "permission-too-high"
  | "managed-department-too-wide"
  | "self-permission-change";

export type SaveOutcome =
  /**
   * `password` CHỈ có ở lượt tạo — mật khẩu khởi tạo dạng chữ, hiện đúng một
   * lần cho người tạo chép rồi gửi cho nhân viên. Database chỉ giữ bản băm, nên
   * bỏ lỡ lần này thì phải bấm "Đặt lại mật khẩu" để sinh mật khẩu khác.
   */
  | { ok: true; staff: StaffAccount; password?: string }
  | { ok: false; code: SaveErrorCode };

/**
 * Bảng tra, KHÔNG phải chuỗi ternary: `Record<SaveErrorCode, …>` bắt buộc liệt
 * kê đủ mã, nên thêm mã mới mà quên câu thông báo thì không biên dịch được.
 *
 * Bản ternary cũ có nhánh `else` bắt tất, và nhánh đó là câu của
 * `permission-too-high` — mã mới nào quên khai đều lặng lẽ hiện câu đó.
 *
 * Cùng kiểu với `MODULE_LABEL` · `ACTION_LABEL` · `SCOPE_LABEL` ở `lib/types.ts`.
 */
const SAVE_ERROR_MESSAGE: Record<SaveErrorCode, string> = {
  "username-taken": "Tên đăng nhập này đã có người dùng",
  "staff-code-taken": "Mã nhân viên này đã có người dùng",
  "role-too-high": "Bạn không gán được chức vụ cao hơn quyền của chính mình",
  "managed-department-too-wide": "Bạn chỉ giao được những phòng chính mình đang quản",
  "self-permission-change":
    "Bạn không sửa được quyền của chính mình — nhờ người có quyền cấp phát làm giúp",
  "permission-too-high": "Có quyền bạn đang cấp vượt quá quyền của chính bạn",
};

export const saveError = (code: SaveErrorCode) => ({ code, message: SAVE_ERROR_MESSAGE[code] });

/** Máy chủ PHẢI kiểm lại chức vụ — ẩn bớt lựa chọn trong ô chọn không phải là phân quyền. */
const checkRole = (actor: User, form: StaffForm): boolean =>
  assignableRoles(actor).includes(form.role);

/** Từng bộ ba client gửi lên phải nằm trong tầm actor được cấp (spec §10.1). */
const checkPermissions = (actor: User, form: StaffForm): boolean =>
  form.permissions.every((perm) => canGrant(actor, perm));

/**
 * Danh sách "phòng phụ trách" cũng là một trục phân quyền, không phải dữ liệu hồ sơ.
 *
 * `visibleDepartmentIds(u, 'managed')` trả thẳng danh sách này, nên mọi quyền
 * phạm vi `managed` của người được sửa nở đúng theo nó. Không chặn thì trưởng
 * phòng tự PATCH hồ sơ CHÍNH MÌNH, tích hết 15 phòng, và có tầm nhìn toàn công
 * ty — `canGrant` không thấy gì bất thường vì phạm vi vẫn đúng chữ `managed`.
 */
const checkManagedDepartments = (actor: User, form: StaffForm, action: Action): boolean => {
  if (form.manageScope !== "listed") return true;
  const allowed = visibleDepartmentIds(actor, clampScope(actor, "staff", action, null));
  // null = phạm vi toàn công ty, giao phòng nào cũng được.
  if (allowed === null) return true;
  return form.managedDepartmentIds.every((id) => allowed.includes(id));
};

/**
 * Quyền BỊ GỠ cũng phải nằm trong tầm actor, y như quyền được cấp.
 *
 * `checkPermissions` chỉ soi mảng gửi lên, mà `writeStaff` xoá sạch rồi ghi lại
 * — nên cái KHÔNG gửi lên là cái bị xoá, không ai kiểm. Giám đốc mở hồ sơ tài
 * khoản quản trị rồi bấm Lưu là `cấp quyền` biến mất, và không đường nào cấp
 * lại được vì cấp `cấp quyền` đòi phải đang có nó.
 */
/**
 * Bộ quyền gửi lên có y hệt bộ đang lưu không — so theo TẬP, không theo thứ tự,
 * vì biểu mẫu dựng lại mảng mỗi lần mở nên thứ tự không hứa hẹn gì.
 *
 * Không dùng `strippedPermissions` được: hàm đó chỉ nhìn chiều GỠ BỚT, mà tự
 * CẤP THÊM cho mình mới là chuyện phải chặn.
 */
const samePermissions = (current: StaffAccount, form: StaffForm): boolean => {
  const key = (p: { module: string; action: string; scope: string }) =>
    `${p.module}:${p.action}:${p.scope}`;
  const had = new Set(current.permissions.map(key));
  const sent = new Set(form.permissions.map(key));
  return had.size === sent.size && [...had].every((k) => sent.has(k));
};

const strippedPermissions = (current: StaffAccount, form: StaffForm) =>
  current.permissions.filter(
    (had) =>
      !form.permissions.some(
        (kept) =>
          kept.module === had.module &&
          kept.action === had.action &&
          // Thu hẹp phạm vi cũng là gỡ bớt quyền.
          SCOPES.indexOf(kept.scope) >= SCOPES.indexOf(had.scope),
      ),
  );

async function usernameTaken(username: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      exceptId
        ? and(eq(users.username, username), ne(users.id, exceptId))
        : eq(users.username, username),
    )
    .limit(1);
  return rows.length > 0;
}

async function staffCodeTaken(staffCode: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      exceptId
        ? and(eq(users.staffCode, staffCode), ne(users.id, exceptId))
        : eq(users.staffCode, staffCode),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Ghi user + quyền + phòng quản trong MỘT transaction — không có nửa người.
 *
 * Trả về mật khẩu khởi tạo ở lượt tạo, `null` ở lượt sửa. Sinh trong này chứ
 * không sinh ở `createStaff` để chuỗi chữ và bản băm chắc chắn cùng một giá
 * trị — hai chỗ sinh riêng là thứ sớm muộn lệch nhau.
 */
async function writeStaff(
  id: string,
  form: StaffForm,
  mode: "create" | "update",
): Promise<string | null> {
  let password: string | null = null;
  await db.transaction(async (tx) => {
    const managed = form.manageScope === "listed" ? form.managedDepartmentIds : [];

    if (mode === "create") {
      // Mật khẩu khởi tạo ngẫu nhiên, KHÔNG có mặc định đoán được. Chuỗi chữ
      // đi ngược lên cho hộp thoại hiện một lần; database chỉ giữ bản băm.
      password = newPassword();
      await tx.insert(users).values({
        id,
        username: form.username,
        staffCode: form.staffCode,
        passwordHash: hashSync(password, 10),
        fullName: form.fullName,
        phone: form.phone,
        role: form.role,
        title: form.title,
        departmentId: form.departmentId || null,
        manageScope: form.manageScope,
      });
    } else {
      /**
       * Chuyển phòng thì DỮ LIỆU ĐI THEO NGƯỜI (chốt 13/08).
       *
       * Bốn bảng nghiệp vụ chụp `created_by_department_id` lúc tạo. Đội chốt
       * bản ghi của một người luôn thuộc phòng họ ĐANG ở, nên lượt chuyển phòng
       * phải viết lại cột đó — cùng lối với điểm KPI, vốn khoá theo `user_id`
       * nên vẫn đi theo người.
       *
       * Viết lại cột chứ không bỏ cột rồi nối sang `users` lúc truy vấn: nối
       * thì bốn chỉ mục `*_dept_date` hết tác dụng, và lọc theo phòng buộc phải
       * nối `users` TRƯỚC khi cắt trang — đúng hình dạng câu hỏi mà AGENTS.md
       * §5.2 cấm.
       */
      const [before] = await tx
        .select({ departmentId: users.departmentId })
        .from(users)
        .where(eq(users.id, id));
      const movedTo = form.departmentId || null;
      if (before && before.departmentId !== movedTo) {
        for (const table of [bankAccounts, insuranceOrders, services, customers])
          await tx
            .update(table)
            .set({ createdByDepartmentId: movedTo })
            .where(eq(table.createdBy, id));
      }

      await tx
        .update(users)
        .set({
          username: form.username,
          staffCode: form.staffCode,
          fullName: form.fullName,
          phone: form.phone,
          role: form.role,
          title: form.title,
          departmentId: form.departmentId || null,
          manageScope: form.manageScope,
          updatedAt: new Date(),
          // KHÔNG đụng `active`: khoá/mở khoá đi đường riêng — sửa hồ sơ mà
          // vô tình mở khoá người đã nghỉ việc là chuyện không được xảy ra.
        })
        .where(eq(users.id, id));
      await tx.delete(userPermissions).where(eq(userPermissions.userId, id));
      await tx.delete(userManagedDepartments).where(eq(userManagedDepartments.userId, id));

      /**
       * Bộ quyền mới KHÔNG còn `manage-assigned-banks` thì dọn danh sách ngân
       * hàng đã giao.
       *
       * Giữ lại là dữ liệu chết — `visibleBankIds` không đọc tới khi không có
       * quyền đó — và cột "Người quản" ở màn ngân hàng sẽ hiện tên một người
       * không sửa được gì.
       */
      if (!form.permissions.some((p) => p.action === "manage-assigned-banks")) {
        await tx.delete(userManagedBanks).where(eq(userManagedBanks.userId, id));
      }
    }

    // Khoá chính của `user_permissions` là (user, module, action) nên hai dòng
    // cùng module + hành động mà khác phạm vi là vỡ 23505. Giữ phạm vi RỘNG
    // nhất cho mỗi cặp — hẹp hơn thì thừa, vì `scopeFor` vốn đã lấy rộng nhất.
    const widest = new Map<string, (typeof form.permissions)[number]>();
    for (const p of form.permissions) {
      const key = `${p.module}:${p.action}`;
      // Hành động không chia được theo phạm vi thì nắn về `company` NGAY Ở ĐÂY,
      // không tin ô chọn của giao diện: ẩn lựa chọn không phải là phân quyền, và
      // một request nặn tay vẫn gửi `own` lên được. Ghi `own` cho `manage-org`
      // là để lại một dòng trông như hẹp mà đọc trọn nhật ký công ty.
      const normalized = SCOPELESS_ACTIONS.includes(p.action)
        ? { ...p, scope: "company" as const }
        : p;
      const kept = widest.get(key);
      if (!kept || SCOPES.indexOf(normalized.scope) > SCOPES.indexOf(kept.scope))
        widest.set(key, normalized);
    }

    if (widest.size > 0)
      await tx.insert(userPermissions).values(
        [...widest.values()].map((p) => ({
          userId: id,
          module: p.module,
          action: p.action,
          scope: p.scope,
        })),
      );
    if (managed.length > 0)
      await tx
        .insert(userManagedDepartments)
        .values(managed.map((departmentId) => ({ userId: id, departmentId })));
  });
  return password;
}

/**
 * Trần vai và trần quyền kiểm TRƯỚC "tên đã có người dùng".
 *
 * Ngược lại là hở oracle: người không có quyền tạo vẫn nhận `422 username-taken`
 * cho tên có thật và `role-too-high` cho tên chưa có — một request là dò được
 * từng tên đăng nhập lẫn từng mã nhân viên trong công ty.
 */
const checkCeilings = (actor: User, form: StaffForm, action: Action): SaveErrorCode | null => {
  if (!checkRole(actor, form)) return "role-too-high";
  if (!checkPermissions(actor, form)) return "permission-too-high";
  if (!checkManagedDepartments(actor, form, action)) return "managed-department-too-wide";
  return null;
};

/** Trùng khoá lúc ghi → đúng mã lỗi 422 mà client đang chờ, không phải 500. */
async function writeGuarded(
  id: string,
  form: StaffForm,
  mode: "create" | "update",
): Promise<{ code: SaveErrorCode } | { password: string | null }> {
  try {
    return { password: await writeStaff(id, form, mode) };
  } catch (e) {
    const constraint = uniqueViolationOf(e);
    if (constraint === null) throw e;
    if (constraint.includes("staff_code")) return { code: "staff-code-taken" };
    if (constraint.includes("username")) return { code: "username-taken" };
    throw e;
  }
}

export async function createStaff(actor: User, form: StaffForm): Promise<SaveOutcome> {
  const ceiling = checkCeilings(actor, form, "create");
  if (ceiling) return { ok: false, code: ceiling };
  if (await usernameTaken(form.username)) return { ok: false, code: "username-taken" };
  if (await staffCodeTaken(form.staffCode)) return { ok: false, code: "staff-code-taken" };

  const id = crypto.randomUUID();
  const written = await writeGuarded(id, form, "create");
  if ("code" in written) return { ok: false, code: written.code };
  return { ok: true, staff: (await findStaff(id))!, password: written.password ?? undefined };
}

export async function updateStaff(actor: User, id: string, form: StaffForm): Promise<SaveOutcome | null> {
  const current = await findStaff(id);
  if (!current) return null;

  /**
   * TỰ sửa quyền của chính mình thì TỪ CHỐI thẳng.
   *
   * Không có chốt này thì cắt quyền một người là vô nghĩa: trần cấp phát lấy
   * MAX của "quyền đang cầm" và "bộ mặc định của mọi chức vụ mình gán được",
   * mà ai cũng gán được chức vụ NGANG BẬC mình. Nên một Trưởng phòng bị cắt còn
   * 2 quyền vẫn bấm "Đặt lại theo chức vụ" trên hồ sơ chính mình là khôi phục
   * đủ 33 quyền, gồm `customer:export` toàn công ty.
   *
   * `/active` và `/reset-password` đã chặn tự thao tác từ trước; riêng đường
   * PATCH này bỏ sót.
   *
   * So bộ quyền chứ không chặn thẳng mọi lượt tự PATCH: biểu mẫu gửi CẢ form kể
   * cả khi người ta chỉ sửa số điện thoại của mình, và việc đó vẫn phải chạy
   * được. Chỉ khi bộ quyền khác đi mới là chuyện phải chặn.
   */
  if (id === actor.id && !samePermissions(current, form))
    return { ok: false, code: "self-permission-change" };

  const ceiling = checkCeilings(actor, form, "update");
  if (ceiling) return { ok: false, code: ceiling };
  if (!strippedPermissions(current, form).every((perm) => canGrant(actor, perm)))
    return { ok: false, code: "permission-too-high" };
  if (await usernameTaken(form.username, id)) return { ok: false, code: "username-taken" };
  if (await staffCodeTaken(form.staffCode, id)) return { ok: false, code: "staff-code-taken" };

  const movedDepartment = (current.departmentId ?? null) !== (form.departmentId || null);

  const written = await writeGuarded(id, form, "update");
  if ("code" in written) return { ok: false, code: written.code };

  /**
   * Rổ quà tính lại sau khi chuyển phòng — chốt 13/08.
   *
   * Luật quà đọc phòng của người lập hồ sơ khách để biết có áp phần quy đổi của
   * Phòng Y không (thể lệ mục 4). `writeStaff` vừa dời khách sang phòng mới nên
   * rổ của họ đã khác, mà cột `customers.gift_basket` lưu sẵn thì chưa biết.
   *
   * Đợt ĐÃ phát không đụng tới: `gift_grants.snapshot` đóng băng (spec §5.3),
   * và `recomputeGiftCase` chỉ ghi cột `gift_basket` của khách.
   */
  if (movedDepartment) {
    const moved = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.createdBy, id));
    for (const row of moved) await recomputeGiftCase(row.id);
  }

  return { ok: true, staff: (await findStaff(id))! };
}

export async function setStaffActive(id: string, active: boolean): Promise<StaffAccount | null> {
  const [row] = await db
    .update(users)
    .set({ active, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) return null;
  return findStaff(id);
}

/**
 * Mật khẩu sinh ngẫu nhiên, bỏ các ký tự dễ đọc nhầm khi nhắn qua Zalo.
 *
 * Dùng `randomInt` của `node:crypto`, KHÔNG dùng `Math.random`: V8 chạy
 * xorshift128+, khôi phục được trạng thái từ một số lượng đầu ra vừa phải. Ai
 * hay đặt lại mật khẩu cho người khác sẽ gom đủ mẫu để đoán mật khẩu của những
 * lần sau, kể cả cho tài khoản họ chưa từng đụng tới.
 */
export function newPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

/** Sinh mật khẩu MỚI, trả về đúng một lần — mật khẩu cũ băm một chiều, không đọc lại được. */
export async function resetPassword(id: string): Promise<string | null> {
  const password = newPassword();
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ passwordHash: hashSync(password, 10), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    // Đặt lại mật khẩu thường là vì tài khoản bị lộ — không cắt phiên đang sống
    // thì kẻ chiếm tài khoản vẫn vào được bằng cookie cũ tới cả năm.
    if (updated[0]) await tx.delete(sessions).where(eq(sessions.userId, id));
    return updated;
  });
  return row ? password : null;
}

/**
 * C-02 · Tự đổi mật khẩu. Trả `false` khi mật khẩu hiện tại sai.
 *
 * Vẫn đòi mật khẩu hiện tại dù đã có phiên hợp lệ: máy để mở vài phút là đủ để
 * người khác đổi mật khẩu và chiếm hẳn tài khoản.
 *
 * Cắt mọi phiên khác nhưng GIỮ phiên đang gọi. `resetPassword` cắt sạch vì lúc
 * đó người thao tác là quản trị, còn ở đây chính chủ đang ngồi đổi — cắt sạch
 * là vừa bấm xong đã bị đá về màn đăng nhập.
 */
export async function changeOwnPassword(
  id: string,
  form: { currentPassword: string; newPassword: string },
  keepSessionHash: string | null,
): Promise<boolean> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!row) return false;
  if (!(await compare(form.currentPassword, row.passwordHash))) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: hashSync(form.newPassword, 10), updatedAt: new Date() })
      .where(eq(users.id, id));
    await tx
      .delete(sessions)
      .where(
        keepSessionHash
          ? and(eq(sessions.userId, id), ne(sessions.tokenHash, keepSessionHash))
          : eq(sessions.userId, id),
      );
  });
  return true;
}

/** Mở khoá đăng nhập (C-01) khi admin mở khoá một người bị khoá 15 phút. */
export async function clearLoginLock(id: string): Promise<void> {
  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, id));
}
