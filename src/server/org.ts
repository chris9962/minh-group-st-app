import { and, asc, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { businessDay, matchesSearch, monthRange, removeDiacritics, uniqueCode } from "@/lib/format";
import {
  ORG_ERROR,
  type DepartmentDetail,
  type DepartmentList,
  type DepartmentRow,
  type DepartmentStats,
  type OrgErrorCode,
} from "@/lib/api/org";
import { db, uniqueViolationOf } from "./db/client";
import { bankAccounts, banks, departments, userManagedDepartments, users } from "./db/schema";

/**
 * P-91 · Phòng ban — bản DB của src/mocks/org.ts, cùng luật:
 * không xoá cứng, không ngừng phòng còn người, so trùng tên bỏ dấu.
 */

const sameNameKey = (name: string): string =>
  removeDiacritics(name).trim().toLowerCase();

/** MỘT câu GROUP BY cho headcount mọi phòng — không đếm từng phòng một (N+1). */
async function rowsWithHeadcount(): Promise<DepartmentRow[]> {
  const rows = await db
    .select({
      id: departments.id,
      name: departments.name,
      active: departments.active,
      headcount: count(users.id),
    })
    .from(departments)
    .leftJoin(users, eq(users.departmentId, departments.id))
    .groupBy(departments.id)
    .orderBy(asc(departments.name));

  return rows.map((r) => ({ ...r, headcount: Number(r.headcount) }));
}

async function headcountOf(id: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.departmentId, id));
  return Number(row?.n ?? 0);
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  // So bỏ dấu + thường hoá phải làm cùng một cách ở cả hai phía — kéo tên về
  // so bằng chính hàm của lib/format thay vì đoán lại collation trong SQL.
  const all = await db.select({ id: departments.id, name: departments.name }).from(departments);
  const key = sameNameKey(name);
  return all.some((d) => d.id !== exceptId && sameNameKey(d.name) === key);
}

export async function departmentsFor(search: string): Promise<DepartmentList> {
  const rows = await rowsWithHeadcount();

  // Tìm kiếm KHÔNG áp lên phần tóm tắt — gõ tên một phòng không có nghĩa là
  // công ty chỉ còn một phòng.
  //
  // `matchesSearch` chứ không phải `includes`: nó tách từ khoá thành từng từ,
  // không phụ thuộc thứ tự và gộp khoảng trắng thừa. Dùng substring thì "2 kinh"
  // hay "kinh  doanh" (hai dấu cách, hay gặp khi dán) đều ra 0 kết quả.
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

export async function activeDepartments() {
  return db
    .select({ id: departments.id, name: departments.name, active: departments.active })
    .from(departments)
    .where(eq(departments.active, true))
    .orderBy(asc(departments.name));
}

export type OrgOutcome =
  | { ok: true; department: DepartmentRow }
  | { ok: false; code: OrgErrorCode };

/** Cùng lời nhắn với bản mock — FE đã hiện đúng các câu này. */
/** Bảng tra — thêm mã mà quên câu thông báo thì không biên dịch được. Xem `staff.ts`. */
const ORG_ERROR_MESSAGE: Record<OrgErrorCode, string> = {
  [ORG_ERROR.NAME_TAKEN]: "Đã có phòng tên này",
  [ORG_ERROR.NOT_EMPTY]: "Phòng này vẫn còn người — chuyển họ sang phòng khác trước",
};

export const orgError = (code: OrgErrorCode) => ({ code, message: ORG_ERROR_MESSAGE[code] });

/**
 * Mã cố định sinh từ tên: "Phòng Kinh doanh 10" → `PHONG-KINH-DOANH-10`.
 *
 * Module luật theo kỳ trỏ vào phòng bằng mã này (spec §5.3) nên nó KHÔNG BAO
 * GIỜ đổi, kể cả khi phòng đổi tên — sinh đúng một lần lúc lập phòng. Trùng
 * thì nối số, không ghi đè mã của phòng khác.
 */
async function nextDepartmentCode(name: string): Promise<string> {
  const taken = new Set(
    (await db.select({ code: departments.code }).from(departments)).map((d) => d.code),
  );
  return uniqueCode(name, "PHONG", taken);
}

export async function createDepartment(name: string): Promise<OrgOutcome> {
  if (await nameTaken(name)) return { ok: false, code: ORG_ERROR.NAME_TAKEN };

  const insert = async (): Promise<OrgOutcome> => {
    const [row] = await db
      .insert(departments)
      .values({ code: await nextDepartmentCode(name), name })
      .returning();
    return { ok: true, department: { id: row.id, name: row.name, active: row.active, headcount: 0 } };
  };

  // `nameTaken` và `nextDepartmentCode` đều là đọc-rồi-mới-ghi: hai request
  // song song cùng lọt qua, rồi một cái đụng unique index của `name`/`code`.
  // Không bắt thì client nhận 500 trần thay vì 422 `name-taken` như hợp đồng.
  try {
    return await insert();
  } catch (e) {
    const constraint = uniqueViolationOf(e);
    if (constraint === null) throw e;
    // Đụng unique của `name` mới là trùng tên. Đụng `code` chỉ là hai request
    // cùng giành một mã — cấp mã mới rồi ghi lại; báo "đã có phòng tên này" ở
    // đó là nói sai chuyện, người dùng không có gì để sửa.
    if (!constraint.includes("code")) return { ok: false, code: ORG_ERROR.NAME_TAKEN };
    return await insert();
  }
}

export async function renameDepartment(id: string, name: string): Promise<OrgOutcome | null> {
  const [current] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!current) return null;
  if (await nameTaken(name, id)) return { ok: false, code: ORG_ERROR.NAME_TAKEN };

  // Giữ nguyên `active`: ngừng / mở lại đi bằng đường riêng.
  let row;
  try {
    [row] = await db
      .update(departments)
      .set({ name, updatedAt: sql`now()` })
      .where(eq(departments.id, id))
      .returning();
  } catch (e) {
    if (uniqueViolationOf(e) !== null) return { ok: false, code: ORG_ERROR.NAME_TAKEN };
    throw e;
  }
  return {
    ok: true,
    department: { id: row.id, name: row.name, active: row.active, headcount: await headcountOf(id) },
  };
}

/** Máy chủ PHẢI kiểm lại số người — vô hiệu nút ở giao diện không phải là phân quyền. */
export async function setDepartmentActive(
  id: string,
  active: boolean,
): Promise<OrgOutcome | null> {
  const [current] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!current) return null;

  const headcount = await headcountOf(id);
  // Chỉ chặn lúc NGỪNG — phòng còn người càng phải mở lại được.
  if (!active && headcount > 0) return { ok: false, code: ORG_ERROR.NOT_EMPTY };

  const [row] = await db
    .update(departments)
    .set({ active, updatedAt: sql`now()` })
    .where(eq(departments.id, id))
    .returning();
  return { ok: true, department: { id: row.id, name: row.name, active: row.active, headcount } };
}

/**
 * Người quản lý một phòng — chỉ tính cấp Phó GĐ trở lên; không ai quản thì
 * hiện Giám đốc theo mặc định (quyết định #44 — company không liệt kê từng phòng).
 */
export async function departmentDetailFor(id: string): Promise<DepartmentDetail | null> {
  const [department] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  if (!department) return null;

  const listed = await db
    .select({ id: users.id, fullName: users.fullName, title: users.title })
    .from(userManagedDepartments)
    .innerJoin(users, eq(users.id, userManagedDepartments.userId))
    .where(
      and(
        eq(userManagedDepartments.departmentId, id),
        eq(users.role, "deputy-director"),
        eq(users.manageScope, "listed"),
        // Người đã bị khoá không đăng nhập được nên không quản được gì. Không
        // lọc thì phòng hiện tên một người không vào nổi hệ thống, mà vì danh
        // sách khác rỗng nên cũng không rơi về Giám đốc.
        eq(users.active, true),
      ),
    );

  const managedByDefault = listed.length === 0;
  const managers = managedByDefault
    ? await db
        .select({ id: users.id, fullName: users.fullName, title: users.title })
        .from(users)
        .where(and(eq(users.role, "director"), eq(users.active, true)))
    : listed;

  return {
    department: {
      id: department.id,
      name: department.name,
      active: department.active,
      headcount: await headcountOf(id),
    },
    managers,
    managedByDefault,
  };
}

/* ── P-91 · Số liệu nghiệp vụ theo phòng ───────────────────────────────── */

export type Range = { from: string; to: string };

/** Lùi một ngày, giữ dạng `YYYY-MM-DD`. */
const dayBefore = (day: string): string =>
  new Date(`${day}T00:00:00Z`).getTime() - 86_400_000 > 0
    ? new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
    : day;

/** Lùi một tháng, giữ dạng `YYYY-MM`. */
const monthBefore = (yearMonth: string): string => {
  const [y, m] = yearMonth.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * Đọc chuỗi kỳ mà `PeriodPicker` gửi lên: `today`, `this-month`, hoặc
 * `range:YYYY-MM-DD:YYYY-MM-DD`.
 *
 * `previous` là kỳ liền trước để so tăng/giảm, và nó `null` với khoảng ngày tự
 * chọn — một khoảng tuỳ ý không có "kỳ liền trước" nào định nghĩa được. Chuỗi
 * lạ rơi về `today` chứ không trả 400: một ô địa chỉ gõ nhầm không đáng làm
 * hỏng cả màn.
 */
function periodRanges(key: string, today: string): { current: Range; previous: Range | null } {
  if (key === "this-month") {
    const month = today.slice(0, 7);
    return { current: monthRange(month), previous: monthRange(monthBefore(month)) };
  }

  const range = key.match(/^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (range) return { current: { from: range[1], to: range[2] }, previous: null };

  const yesterday = dayBefore(today);
  return { current: { from: today, to: today }, previous: { from: yesterday, to: yesterday } };
}

/**
 * Đếm tài khoản mở, app đã cài và số khách theo phòng, trong một khoảng ngày.
 *
 * Gộp theo `created_by_department_id` — cột trên chính dòng dữ liệu, không nối
 * sang `users`. Người chuyển phòng thì `writeStaff` viết lại cột đó cho mọi dòng
 * của họ, nên số liệu đi theo người (chốt 13/08). Nối `users` lúc truy vấn cho
 * cùng kết quả, nhưng mất bốn chỉ mục `*_dept_date` và buộc nối trước khi cắt
 * trang — đúng hình dạng câu hỏi mà AGENTS.md §5.2 cấm.
 *
 * "App đã cài" đếm tài khoản có `app_installed` VÀ ngân hàng đó `counts_as_app`
 * — cùng định nghĩa với cảnh báo mềm ở `server/banking.ts`. Đây là phép ĐẾM dữ
 * liệu thô, khác hẳn công thức tính ĐIỂM đang chờ file luật của kỳ: thể lệ
 * 03/08 viết lại cách quy điểm cho một combo, không viết lại chuyện một tài
 * khoản có cài app hay không.
 */
export async function statsByDepartment(range: Range) {
  const rows = await db
    .select({
      departmentId: bankAccounts.createdByDepartmentId,
      accountsOpened: sql<number>`count(*)::int`,
      appsInstalled: sql<number>`count(*) filter (where ${bankAccounts.appInstalled} and ${banks.countsAsApp})::int`,
      customers: sql<number>`count(distinct ${bankAccounts.customerId})::int`,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(
      and(
        // Bản `creating` mới là lượt giữ chỗ mã, chưa phải tài khoản thật.
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, range.from),
        lte(bankAccounts.openedDate, range.to),
      ),
    )
    .groupBy(bankAccounts.createdByDepartmentId);

  return new Map(
    rows
      .filter((r) => r.departmentId !== null)
      .map((r) => [r.departmentId as string, r]),
  );
}

/**
 * Cùng bốn con số, gộp theo NGƯỜI TẠO thay vì theo phòng.
 *
 * Màn Tổng quan của Trưởng phòng và Phó phòng dùng nó: họ chỉ thấy một phòng,
 * nên bảng xếp hạng phòng của họ có đúng một dòng và không nói lên điều gì.
 *
 * Lọc theo `created_by_department_id` chứ không theo danh sách nhân sự đang
 * thuộc phòng: hai cách cho kết quả khác nhau khi có người vừa chuyển đi. Cách
 * này bảo đảm tổng bảng nhân viên của Trưởng phòng bằng đúng dòng phòng đó
 * trong bảng của Giám đốc.
 */
export async function statsByStaff(range: Range, departmentIds: string[]) {
  const rows = await db
    .select({
      staffId: bankAccounts.createdBy,
      accountsOpened: sql<number>`count(*)::int`,
      appsInstalled: sql<number>`count(*) filter (where ${bankAccounts.appInstalled} and ${banks.countsAsApp})::int`,
      customers: sql<number>`count(distinct ${bankAccounts.customerId})::int`,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(
      and(
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, range.from),
        lte(bankAccounts.openedDate, range.to),
        inArray(bankAccounts.createdByDepartmentId, departmentIds),
      ),
    )
    .groupBy(bankAccounts.createdBy);

  return new Map(rows.filter((r) => r.staffId !== null).map((r) => [r.staffId as string, r]));
}

const rateOf = (opened: number, installed: number): number =>
  opened === 0 ? 0 : Math.round((installed / opened) * 100);

/**
 * P-91 · Bốn cột số liệu của bảng phòng ban, luôn ở phạm vi TOÀN CÔNG TY.
 *
 * Trả về mọi phòng đang hoạt động, kể cả phòng không phát sinh gì — chúng mang
 * số 0 chứ không vắng mặt. Bỏ chúng đi thì giao diện hiện `—`, mà `—` có nghĩa
 * "không đọc được số" chứ không phải "tháng này chưa mở tài khoản nào".
 */
export async function departmentStatsFor(periodKey: string): Promise<DepartmentStats> {
  const { current, previous } = periodRanges(periodKey, businessDay());

  const [rows, now, before] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.active, true))
      .orderBy(asc(departments.name)),
    statsByDepartment(current),
    previous ? statsByDepartment(previous) : Promise.resolve(null),
  ]);

  return {
    departments: rows.map((d) => {
      const s = now.get(d.id);
      const p = before?.get(d.id);
      return {
        id: d.id,
        name: d.name,
        accountsOpened: s?.accountsOpened ?? 0,
        appsInstalled: s?.appsInstalled ?? 0,
        customers: s?.customers ?? 0,
        // `null` khi không có kỳ trước để so, HOẶC kỳ trước phòng này không mở
        // tài khoản nào: 0% so với "chưa có gì" là một phép trừ vô nghĩa, và
        // mũi tên giảm 74 điểm đọc ra như tai nạn.
        previousInstallRate:
          p && p.accountsOpened > 0 ? rateOf(p.accountsOpened, p.appsInstalled) : null,
      };
    }),
  };
}
