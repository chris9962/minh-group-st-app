import { and, asc, count, desc, eq, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Page } from "@/lib/api/pagination";
import type { VneidEditForm, VneidFilters, VneidForm, VneidRow, VneidSort } from "@/lib/api/vneid";
import { BUSINESS_TIMEZONE } from "@/lib/format";
import { recordInScope, recordVisibility, type RecordVisibility } from "@/lib/permissions";
import { searchTerms } from "@/lib/search";
import { isRealIsoDate, type User } from "@/lib/types";
import { uuidParam } from "./auth";
import { closedMonthMessage, closedMonthOfCustomer, customerMonthClosed } from "./closedMonths";
import { addressWhere } from "./customers";
import { db, uniqueViolationOf } from "./db/client";
import { customers, departments, users, vneidRecords } from "./db/schema";
import type { PageArgs } from "./pagination";
import { imageKeyOf, imageUrl } from "./storage";
import { departmentForNewRecord } from "./writeDepartment";

/**
 * Tích hợp VNeID — cùng khuôn với `server/services.ts`: phạm vi mức dòng, lọc
 * và cắt trang chỉ trên bảng `vneid_records`, rồi mới dán tên khách và tên
 * người làm cho đúng một trang (AGENTS.md §5.2). Không tính điểm KPI.
 *
 * Ngày thực hiện là `created_at`: hiện, lọc, sắp đều theo cột đó.
 */

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const TASK_COLUMN = {
  healthInsurance: vneidRecords.healthInsurance,
  socialWelfare: vneidRecords.socialWelfare,
  digitalSignature: vneidRecords.digitalSignature,
} as const;

/** Bộ lọc từ địa chỉ trang. Giá trị hỏng thì bỏ lọc, không làm vỡ cả màn. */
export const vneidFiltersFrom = (params: URLSearchParams): VneidFilters => {
  const task = params.get("task") ?? "";
  return {
    search: params.get("search") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    departmentId: uuidParam(params.get("departmentId")),
    staffId: uuidParam(params.get("staffId")),
    customerId: uuidParam(params.get("customerId")),
    task: Object.hasOwn(TASK_COLUMN, task) ? (task as keyof typeof TASK_COLUMN) : "",
    address: params.get("address") ?? "",
  };
};

const scopeOf = (actor: User, action: "view-detail" | "update" | "delete" | "export") =>
  recordVisibility(actor, "vneid", action);

const scopeWhere = (v: RecordVisibility): SQL | undefined => {
  switch (v.kind) {
    case "all":
      return undefined;
    case "departments":
      return inArray(vneidRecords.createdByDepartmentId, v.departmentIds);
    case "creator":
      return eq(vneidRecords.createdBy, v.userId);
    default:
      return sql`false`;
  }
};

function searchWhere(raw: string): SQL | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  return and(
    ...searchTerms(text).map(
      (term) =>
        sql`exists (
          select 1 from ${customers} c
          where c.id = ${vneidRecords.customerId}
            and c.search_name like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'
        )`,
    ),
  );
}

/** Cùng luật so địa chỉ với ô Ấp của P-40, đặt trong `exists` để vẫn cắt trang trên `vneid_records`. */
function addressFilter(address: string | undefined): SQL | undefined {
  const matches = addressWhere(address);
  if (!matches) return undefined;
  return sql`exists (
    select 1 from ${customers}
    where ${customers.id} = ${vneidRecords.customerId}
      and ${matches}
  )`;
}

/**
 * Tạo từ ngày `day` trở đi, theo giờ Việt Nam. So trên cột gốc để dùng được chỉ
 * mục, cùng cách `customerDayBetween`.
 */
export const createdFrom = (day: string): SQL =>
  sql`${vneidRecords.createdAt} >= ((${day}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`;

const filtersWhere = (visible: RecordVisibility, query: VneidFilters): SQL | undefined => {
  const parts = [
    scopeWhere(visible),
    searchWhere(query.search),
    // Ngày sai thì bỏ điều kiện đó, không trả 400 — cùng lối `services`.
    isRealIsoDate(query.from) ? createdFrom(query.from) : undefined,
    isRealIsoDate(query.to)
      ? sql`${vneidRecords.createdAt} < ((${query.to}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE})`
      : undefined,
    query.departmentId ? eq(vneidRecords.createdByDepartmentId, query.departmentId) : undefined,
    query.staffId ? eq(vneidRecords.createdBy, query.staffId) : undefined,
    query.customerId ? eq(vneidRecords.customerId, query.customerId) : undefined,
    query.task ? eq(TASK_COLUMN[query.task], true) : undefined,
    addressFilter(query.address),
  ].filter(Boolean) as SQL[];
  return parts.length > 0 ? and(...parts) : undefined;
};

const pickPage = (where: SQL | undefined, orderBy: SQL[], limit: number, offset: number) =>
  db
    .select({
      id: vneidRecords.id,
      customerId: vneidRecords.customerId,
      healthInsurance: vneidRecords.healthInsurance,
      socialWelfare: vneidRecords.socialWelfare,
      digitalSignature: vneidRecords.digitalSignature,
      photoUrls: vneidRecords.photoUrls,
      note: vneidRecords.note,
      createdAt: vneidRecords.createdAt,
      createdById: vneidRecords.createdBy,
      createdByDepartmentId: vneidRecords.createdByDepartmentId,
    })
    .from(vneidRecords)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset)
    .as("page");

const decorate = (page: ReturnType<typeof pickPage>) =>
  db
    .select({
      id: page.id,
      customerId: page.customerId,
      customerName: customers.fullName,
      customerAddress: customers.address,
      healthInsurance: page.healthInsurance,
      socialWelfare: page.socialWelfare,
      digitalSignature: page.digitalSignature,
      photoUrls: page.photoUrls,
      note: page.note,
      createdById: page.createdById,
      createdByName: users.fullName,
      createdByCode: users.staffCode,
      createdByDepartmentId: page.createdByDepartmentId,
      createdByDepartmentName: departments.name,
      createdAt: page.createdAt,
      monthClosed: customerMonthClosed(customers.createdAt),
    })
    .from(page)
    .innerJoin(customers, eq(customers.id, page.customerId))
    .innerJoin(users, eq(users.id, page.createdById))
    .leftJoin(departments, eq(departments.id, page.createdByDepartmentId));

/** `id` đứng cuối để hai dòng cùng giờ tạo không đổi chỗ giữa các trang. */
const orderByCreated = (t: { at: SQLWrapper; id: SQLWrapper }, dir: "asc" | "desc"): SQL[] =>
  dir === "asc" ? [asc(t.at), asc(t.id)] : [desc(t.at), asc(t.id)];

/** Phép nối ở câu ngoài không giữ thứ tự của câu con, nên sắp lại cả hai tầng. */
const orderedPage = (where: SQL | undefined, dir: "asc" | "desc", limit: number, offset: number) => {
  const page = pickPage(
    where,
    orderByCreated({ at: vneidRecords.createdAt, id: vneidRecords.id }, dir),
    limit,
    offset,
  );
  return decorate(page).orderBy(...orderByCreated({ at: page.createdAt, id: page.id }, dir));
};

/** Cột giữ KHOÁ ảnh trong kho, giao diện cần URL đọc ảnh. */
const toRow = (row: Awaited<ReturnType<typeof orderedPage>>[number]): VneidRow => ({
  ...row,
  photoUrls: row.photoUrls.map(imageUrl),
  createdAt: row.createdAt.toISOString(),
});

export async function listVneid(
  actor: User,
  filters: VneidFilters,
  page: PageArgs<VneidSort>,
): Promise<Page<VneidRow>> {
  const visible = scopeOf(actor, "view-detail");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = filtersWhere(visible, filters);
  const [rows, [totals]] = await Promise.all([
    orderedPage(where, page.dir, page.limit, page.offset),
    db.select({ value: count() }).from(vneidRecords).where(where),
  ]);
  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

const EXPORT_LIMIT = 20_000;

export async function listVneidForExport(actor: User, filters: VneidFilters): Promise<Page<VneidRow>> {
  const visible = scopeOf(actor, "export");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = filtersWhere(visible, filters);
  const [rows, [totals]] = await Promise.all([
    orderedPage(where, "desc", EXPORT_LIMIT, 0),
    db.select({ value: count() }).from(vneidRecords).where(where),
  ]);
  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

const recordById = async (id: string): Promise<VneidRow | null> => {
  const [row] = await orderedPage(eq(vneidRecords.id, id), "desc", 1, 0);
  return row ? toRow(row) : null;
};

export type VneidOutcome = { ok: true; record: VneidRow } | { ok: false; message: string };

const ALREADY_EXISTS = "Khách này đã có dòng VNeID. Sửa dòng đó để đánh dấu thêm việc.";

/** Tháng của hồ sơ khách đã chốt lương thì không thêm, sửa, xoá dòng VNeID của hồ sơ đó. */
async function closedMessageOf(customerId: string): Promise<string | null> {
  const month = await closedMonthOfCustomer(customerId);
  return month ? closedMonthMessage(month) : null;
}

/** Chỉ nhận khoá trong thư mục `vneid/`: khoá của thư mục khác là ảnh CCCD, ảnh tài khoản ngân hàng. */
function photoKeysOf(urls: string[]): string[] | null {
  const keys = urls.map(imageKeyOf);
  return keys.every((key) => key?.replace(/^demo\//, "").startsWith("vneid/"))
    ? (keys as string[])
    : null;
}

/** Người làm và phòng do máy chủ tự ghi từ phiên đăng nhập, không nhận từ client. */
export async function createVneid(actor: User, form: VneidForm): Promise<VneidOutcome> {
  const [customer] = await db
    .select({ id: customers.id, departmentId: customers.createdByDepartmentId })
    .from(customers)
    .where(eq(customers.id, form.customerId))
    .limit(1);
  if (!customer) return { ok: false, message: "Không tìm thấy khách hàng này" };

  const closed = await closedMessageOf(form.customerId);
  if (closed) return { ok: false, message: closed };

  const [existing] = await db
    .select({ id: vneidRecords.id })
    .from(vneidRecords)
    .where(eq(vneidRecords.customerId, form.customerId))
    .limit(1);
  if (existing) return { ok: false, message: ALREADY_EXISTS };

  const department = departmentForNewRecord(actor, "vneid", form.departmentId, customer.departmentId);
  if (!department.ok) return { ok: false, message: department.message };

  const photoKeys = photoKeysOf(form.photoUrls);
  if (!photoKeys) return { ok: false, message: "Ảnh không hợp lệ" };

  let id: string;
  try {
    const [row] = await db
      .insert(vneidRecords)
      .values({
        customerId: form.customerId,
        healthInsurance: form.healthInsurance,
        socialWelfare: form.socialWelfare,
        digitalSignature: form.digitalSignature,
        photoUrls: photoKeys,
        note: form.note,
        createdBy: actor.id,
        createdByDepartmentId: department.departmentId,
      })
      .returning({ id: vneidRecords.id });
    id = row.id;
  } catch (e) {
    // Hai người cùng ghi cho một khách: phép kiểm ở trên cùng đọc ra "chưa có", khoá duy nhất chặn lượt sau.
    if (uniqueViolationOf(e) === "vneid_records_customer") return { ok: false, message: ALREADY_EXISTS };
    throw e;
  }

  return { ok: true, record: (await recordById(id))! };
}

/** `null` = không có HOẶC ngoài phạm vi — route trả 404 giống nhau để không dò được id. */
export async function updateVneid(actor: User, id: string, form: VneidEditForm): Promise<VneidOutcome | null> {
  const current = await recordById(id);
  if (!current || !recordInScope(scopeOf(actor, "update"), current)) return null;

  const closed = await closedMessageOf(current.customerId);
  if (closed) return { ok: false, message: closed };

  const photoKeys = photoKeysOf(form.photoUrls);
  if (!photoKeys) return { ok: false, message: "Ảnh không hợp lệ" };

  await db
    .update(vneidRecords)
    .set({
      healthInsurance: form.healthInsurance,
      socialWelfare: form.socialWelfare,
      digitalSignature: form.digitalSignature,
      photoUrls: photoKeys,
      note: form.note,
    })
    .where(eq(vneidRecords.id, id));

  return { ok: true, record: (await recordById(id))! };
}

export async function deleteVneid(actor: User, id: string): Promise<VneidOutcome | null> {
  const current = await recordById(id);
  if (!current || !recordInScope(scopeOf(actor, "delete"), current)) return null;

  const closed = await closedMessageOf(current.customerId);
  if (closed) return { ok: false, message: closed };

  await db.delete(vneidRecords).where(eq(vneidRecords.id, id));
  return { ok: true, record: current };
}
