import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  capitalizePersonName,
  PERSON_NAME_LETTER_ERROR,
  personNameHasLetter,
} from "@/lib/api/personName";
import {
  DATA_ENTRY_TYPE_NAME,
  KIND_LABEL,
  parsePlan,
  type ReconcileFileRow,
  type ReconcileImportRequest,
  type ReconcileImportResult,
  type ReconcilePreviewRow,
  type RecordFileRow,
  type RecordImportRequest,
  type RecordImportResult,
  type RecordPreviewRow,
  type SocialInsuranceKind,
  type SocialInsurancePlan,
  PLAN_LABEL,
} from "@/lib/api/socialInsurance";
import { businessDay, removeDiacritics } from "@/lib/format";
import {
  applyRate,
  centsFromDecimal,
  decimalFromCents,
  formatCents,
  formatRate,
  parseMoneyCents,
  parseRate,
} from "@/lib/money";
import { recordVisibility, type RecordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { closedMonthAmong, closedMonthMessage } from "./closedMonths";
import { db } from "./db/client";
import {
  channels,
  collaborators,
  customers,
  provinces,
  refWards,
  serviceTypes,
  services,
  socialInsuranceRecords,
  users,
  wards,
} from "./db/schema";
import { recomputeKpi } from "./kpi";
import { rateBooksFor, type RateBook } from "./socialInsuranceRates";
import { recomputeEmployeeWorkDay } from "./workDays";

export type Conn = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Outcome<T> = { ok: true; result: T } | { ok: false; message: string };

/** Kênh của khách tạo từ file: khách tới Điểm ATM. */
const ATM_CHANNEL_CODE = "KENH-ATM";

/** Một lượt tải xếp hàng với lượt khác, kể cả lượt sửa và xoá dòng. */
export const lockSocialInsurance = (conn: Conn) =>
  conn.execute(sql`select pg_advisory_xact_lock(hashtext('social-insurance'))`);

export const monthLabel = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;

const tail = (idNumber: string) => idNumber.slice(-4);

/** CCCD luôn bắt đầu bằng 0 (mã tỉnh 001–096), mà ô số trong Excel bỏ mất số 0 đó. */
const normalizeIdNumber = (raw: string) => {
  const v = raw.replace(/\s/g, "");
  return /^\d{11}$/.test(v) ? `0${v}` : v;
};

/** Mã số BHXH đủ 10 số, cũng bắt đầu bằng mã tỉnh có số 0 mà ô số trong Excel bỏ mất. */
const normalizeSocialCode = (raw: string) => {
  const v = raw.replace(/\s/g, "");
  return /^\d{9}$/.test(v) ? `0${v}` : v;
};

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * NGÀY BIÊN LAI thành `YYYY-MM`. Nhận `10/2026`, `01/10/2026`, ô ngày của
 * Excel (đọc ra `2026-10-01`) và số ngày kiểu Excel (`46296`).
 */
export function parseReceiptMonth(raw: string): string | null {
  const v = raw.trim();
  let year: number;
  let month: number;
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{4})-(\d{1,2})(-\d{1,2})?$/))) [year, month] = [Number(m[1]), Number(m[2])];
  else if ((m = v.match(/^(\d{1,2})[/.-](\d{4})$/))) [year, month] = [Number(m[2]), Number(m[1])];
  else if ((m = v.match(/^\d{1,2}[/.-](\d{1,2})[/.-](\d{4})$/))) [year, month] = [Number(m[2]), Number(m[1])];
  else if (/^\d{5}$/.test(v)) {
    const date = new Date(EXCEL_EPOCH + Number(v) * 86_400_000);
    [year, month] = [date.getUTCFullYear(), date.getUTCMonth() + 1];
  } else return null;
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Số tháng lớn nhất của một dòng: hợp đồng dài nhất là 12 tháng, chừa trần cho cột `integer`. */
const MAX_MONTHS = 120;

/** Dòng mà người tải file được ghi lên, cùng luật với bảng danh sách (AGENTS.md §6). */
export function recordScopeWhere(v: RecordVisibility): SQL | undefined {
  switch (v.kind) {
    case "all":
      return undefined;
    case "departments":
      return inArray(socialInsuranceRecords.uploadedByDepartmentId, v.departmentIds);
    case "creator":
      return eq(socialInsuranceRecords.uploadedBy, v.userId);
    default:
      return sql`false`;
  }
}

export type Staff = { id: string; fullName: string; departmentId: string | null };

/** Một nhân viên Điểm ATM đang hoạt động, tra theo id. Form sửa chọn nhân viên từ danh sách. */
export async function atmStaffById(id: string, conn: Conn): Promise<Staff | null> {
  const [row] = await conn
    .select({ id: users.id, fullName: users.fullName, departmentId: users.departmentId })
    .from(users)
    .where(and(eq(users.id, id), eq(users.active, true), eq(users.salaryScheme, "atm")));
  return row ?? null;
}

/** Nhân viên Điểm ATM đang hoạt động, tra theo mã viết hoa. */
export async function atmStaffByCode(codes: string[], conn: Conn): Promise<Map<string, Staff>> {
  if (codes.length === 0) return new Map();
  const rows = await conn
    .select({
      id: users.id,
      staffCode: users.staffCode,
      fullName: users.fullName,
      departmentId: users.departmentId,
    })
    .from(users)
    .where(
      and(
        inArray(sql`upper(${users.staffCode})`, codes),
        eq(users.active, true),
        eq(users.salaryScheme, "atm"),
      ),
    );
  return new Map(rows.map((r) => [(r.staffCode ?? "").toUpperCase(), r]));
}

export async function closedMonthsOf(months: string[], conn: Conn): Promise<Set<string>> {
  const closed = new Set<string>();
  for (const month of new Set(months)) if (await closedMonthAmong([month], conn)) closed.add(month);
  return closed;
}

/** Phần "lượt" của một dòng: dùng chung cho file 1 và form sửa dòng. */
export type EntryInput = {
  receiptDate: string;
  plan: string;
  months: string;
  collected: string;
  paid: string;
  staffCode: string;
  collaborator: string;
};

export type Entry = {
  receiptMonth: string;
  plan: SocialInsurancePlan;
  months: number;
  collectedCents: number;
  paidCents: number;
  staff: Staff;
  collaborator: string;
};

export type EntryContext = {
  kind: SocialInsuranceKind;
  staffOf: Map<string, Staff>;
  rateBooks: Map<string, RateBook>;
  closedMonths: Set<string>;
};

export type EntryField = "receiptMonth" | "plan" | "months" | "collected" | "paid" | "staffCode";
export type EntryFieldErrors = Partial<Record<EntryField, string>>;

/**
 * Kiểm phần lượt của một dòng. Trả mọi lỗi tìm được, kèm phần đã đọc được để
 * bảng xem trước vẫn hiện số. Không kiểm trùng khách: việc đó cần biết khách.
 */
export function checkEntry(
  input: EntryInput,
  ctx: EntryContext,
): { errors: string[]; fieldErrors: EntryFieldErrors; partial: Partial<Entry>; entry: Entry | null } {
  const errors: string[] = [];
  const fieldErrors: EntryFieldErrors = {};
  const fail = (field: EntryField, message: string) => {
    errors.push(message);
    fieldErrors[field] ??= message;
  };
  const partial: Partial<Entry> = {};

  const receiptMonth = parseReceiptMonth(input.receiptDate);
  if (!receiptMonth) fail("receiptMonth", "Ngày biên lai phải có dạng mm/yyyy");
  else {
    partial.receiptMonth = receiptMonth;
    if (ctx.closedMonths.has(receiptMonth)) fail("receiptMonth", closedMonthMessage(receiptMonth));
  }

  const plan = parsePlan(input.plan);
  if (!plan) fail("plan", "Phương án phải là Tăng mới hoặc Tái tục");
  else partial.plan = plan;

  const months = input.months.trim();
  if (!/^\d+$/.test(months) || Number(months) <= 0 || Number(months) > MAX_MONTHS)
    fail("months", `Số tháng phải là số nguyên từ 1 tới ${MAX_MONTHS}`);
  else partial.months = Number(months);

  const collected = parseMoneyCents(input.collected);
  if (collected === null || collected === "invalid" || collected <= 0)
    fail("collected", "Số tiền thu phải là số lớn hơn 0");
  else partial.collectedCents = collected;

  const paid = parseMoneyCents(input.paid);
  if (paid === null || paid === "invalid") fail("paid", "Số tiền chi phải là số");
  else partial.paidCents = paid;

  const code = input.staffCode.trim().toUpperCase();
  const staff = ctx.staffOf.get(code);
  if (!code) fail("staffCode", "Thiếu mã nhân viên ở cột NHẬP LIỆU");
  else if (!staff) fail("staffCode", `Mã ${code} không phải nhân viên Điểm ATM đang hoạt động`);
  else partial.staff = staff;

  if (partial.receiptMonth && partial.plan && partial.months && partial.collectedCents !== undefined) {
    const rate = ctx.rateBooks
      .get(partial.receiptMonth)
      ?.get(ctx.kind, partial.plan, partial.months);
    if (!rate)
      fail(
        "months",
        `Chưa cấu hình % hoa hồng cho ${KIND_LABEL[ctx.kind]} ${PLAN_LABEL[partial.plan]} ${partial.months} tháng, tháng ${monthLabel(partial.receiptMonth)}`,
      );
    else if (partial.paidCents !== undefined) {
      const expected = applyRate(partial.collectedCents, rate.payRate);
      if (partial.paidCents !== expected)
        fail(
          "paid",
          `Số tiền chi phải là ${formatCents(expected)} (${formatRate(rate.payRate)} × ${formatCents(partial.collectedCents)})`,
        );
    }
  }

  const entry =
    errors.length === 0
      ? {
          receiptMonth: partial.receiptMonth!,
          plan: partial.plan!,
          months: partial.months!,
          collectedCents: partial.collectedCents!,
          paidCents: partial.paidCents!,
          staff: partial.staff!,
          collaborator: input.collaborator.replace(/\s+/g, " ").trim(),
        }
      : null;
  return { errors, fieldErrors, partial, entry };
}

/** Lượt dịch vụ "Nhập liệu BHYT/BHXH" theo tên. Không đòi đang dùng: loại này đã rút khỏi form Ghi dịch vụ. */
export async function dataEntryTypeId(kind: SocialInsuranceKind, conn: Conn): Promise<string | null> {
  const [type] = await conn
    .select({ id: serviceTypes.id })
    .from(serviceTypes)
    .where(eq(serviceTypes.name, DATA_ENTRY_TYPE_NAME[kind]))
    .limit(1);
  return type?.id ?? null;
}

/** Thêm CTV chưa có, trả id theo tên. */
export async function collaboratorIds(names: string[], conn: Conn): Promise<Map<string, string>> {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return new Map();
  await conn
    .insert(collaborators)
    .values(unique.map((name) => ({ name })))
    .onConflictDoNothing();
  const rows = await conn
    .select({ id: collaborators.id, name: collaborators.name })
    .from(collaborators)
    .where(inArray(collaborators.name, unique));
  return new Map(rows.map((r) => [r.name, r.id]));
}

type RefWard = { name: string; ward: { id: string; name: string } | null };

/**
 * Xã tham chiếu của tỉnh đã chọn. Khớp cả xã công ty chưa triển khai để báo
 * đúng lỗi: gõ sai tên khác với xã chưa có trong danh mục.
 */
type WardBook = {
  province: { id: string; name: string };
  exact: Map<string, RefWard>;
  /** Khoá bỏ dấu. `null` khi hai xã trùng khoá ("Tân Thạnh", "Tân Thành"): phải gõ đúng dấu. */
  folded: Map<string, RefWard | null>;
};

const placeKey = (name: string) => name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const wardKey = (name: string) => placeKey(name).replace(/^(xã|phường|thị trấn|đặc khu)\s+/, "");
const provinceKey = (name: string) =>
  removeDiacritics(placeKey(name).replace(/^(tỉnh|thành phố|tp\.?)\s*/, ""));

async function wardBookOf(provinceId: string, conn: Conn): Promise<WardBook | null> {
  const [province] = await conn
    .select({ id: provinces.id, refId: provinces.refId, name: provinces.name })
    .from(provinces)
    .where(eq(provinces.id, provinceId))
    .limit(1);
  if (!province) return null;
  const rows = await conn
    .select({ name: refWards.name, wardId: wards.id, wardName: wards.name })
    .from(refWards)
    .leftJoin(wards, eq(wards.refId, refWards.id))
    .where(eq(refWards.provinceId, province.refId));
  const exact = new Map<string, RefWard>();
  const folded = new Map<string, RefWard | null>();
  for (const row of rows) {
    const ward: RefWard = {
      name: row.name,
      ward: row.wardId && row.wardName ? { id: row.wardId, name: row.wardName } : null,
    };
    const key = wardKey(row.name);
    exact.set(key, ward);
    const loose = removeDiacritics(key);
    folded.set(loose, folded.has(loose) ? null : ward);
  }
  return { province, exact, folded };
}

/**
 * Cột ĐỊA CHỈ ghi "Ấp, Xã, Tỉnh" hoặc chỉ tên xã. Xã là phần gần cuối nhất có
 * trong danh mục tham chiếu; các phần đứng trước giữ lại làm đầu địa chỉ.
 */
function matchWard(
  address: string,
  book: WardBook,
): { ward: { id: string; name: string }; address: string } | string {
  const parts = address
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  while (parts.length > 0 && provinceKey(parts[parts.length - 1]) === provinceKey(book.province.name)) parts.pop();
  if (parts.length === 0) return "Thiếu xã ở cột ĐỊA CHỈ";
  for (let i = parts.length - 1; i >= 0; i--) {
    const key = wardKey(parts[i]);
    const loose = removeDiacritics(key);
    const ward =
      book.exact.get(key) ??
      book.folded.get(loose) ??
      book.folded.get(loose.replace(/^(xa|phuong|thi tran|dac khu)\s+/, ""));
    if (!ward) continue;
    if (!ward.ward) return `${ward.name} chưa có trong danh mục tỉnh / xã / ấp`;
    return {
      ward: ward.ward,
      address: [...parts.slice(0, i), ward.ward.name, book.province.name].join(", "),
    };
  }
  return `Không tìm thấy xã "${parts[parts.length - 1]}" ở ${book.province.name}`;
}

type ParsedRecord = {
  row: number;
  fullName: string;
  idNumber: string;
  address: string;
  ward: { id: string; name: string };
  socialInsuranceCode: string;
  entry: Entry;
  customerRootId: string | null;
};

/**
 * Kiểm cả file 1. Không ghi gì.
 *
 * Mỗi khách mỗi loại mỗi tháng biên lai đúng một dòng, tính trên mọi lần mở hồ
 * sơ: hồ sơ gốc giữ CCCD duy nhất, nên tra theo hồ sơ gốc là đủ.
 */
async function checkRecords(
  conn: Conn,
  kind: SocialInsuranceKind,
  wardBook: WardBook,
  rows: RecordFileRow[],
): Promise<{ preview: RecordPreviewRow[]; parsed: ParsedRecord[] }> {
  const staffOf = await atmStaffByCode(
    [...new Set(rows.map((r) => r.staffCode.trim().toUpperCase()).filter(Boolean))],
    conn,
  );
  const months = rows.map((r) => parseReceiptMonth(r.receiptDate)).filter((m): m is string => m !== null);
  const ctx: EntryContext = {
    kind,
    staffOf,
    rateBooks: await rateBooksFor(months, conn),
    closedMonths: await closedMonthsOf(months, conn),
  };

  const idNumbers = [...new Set(rows.map((r) => normalizeIdNumber(r.idNumber)).filter((v) => /^\d{12}$/.test(v)))];
  const roots = idNumbers.length
    ? await conn
        .select({
          id: customers.id,
          idNumber: customers.idNumber,
          socialInsuranceCode: customers.socialInsuranceCode,
        })
        .from(customers)
        .where(and(inArray(customers.idNumber, idNumbers), sql`${customers.rootCustomerId} = ${customers.id}`))
    : [];
  const rootOf = new Map(roots.map((r) => [r.idNumber ?? "", r]));

  const codes = [...new Set(rows.map((r) => normalizeSocialCode(r.socialInsuranceCode)).filter(Boolean))];
  const codeOwners = codes.length
    ? await conn
        .select({ id: customers.id, code: customers.socialInsuranceCode })
        .from(customers)
        .where(and(inArray(customers.socialInsuranceCode, codes), sql`${customers.rootCustomerId} = ${customers.id}`))
    : [];
  const ownerOfCode = new Map(codeOwners.map((r) => [r.code ?? "", r.id]));

  const taken = roots.length
    ? await conn
        .select({ customerId: socialInsuranceRecords.customerId, month: socialInsuranceRecords.receiptMonth })
        .from(socialInsuranceRecords)
        .where(
          and(
            eq(socialInsuranceRecords.kind, kind),
            inArray(
              socialInsuranceRecords.customerId,
              roots.map((r) => r.id),
            ),
          ),
        )
    : [];
  const takenKeys = new Set(taken.map((t) => `${t.customerId}|${t.month}`));

  const firstRowOf = new Map<string, number>();
  const codeInFile = new Map<string, string>();
  const idNumberOfCode = new Map<string, string>();
  const preview: RecordPreviewRow[] = [];
  const parsed: ParsedRecord[] = [];

  for (const input of rows) {
    const { errors, partial, entry } = checkEntry(input, ctx);

    const fullName = input.fullName.replace(/\s+/g, " ").trim();
    if (!fullName) errors.unshift("Thiếu họ tên");
    else if (!personNameHasLetter(fullName)) errors.unshift(PERSON_NAME_LETTER_ERROR);

    const idNumber = normalizeIdNumber(input.idNumber);
    if (!idNumber) errors.push("Thiếu CCCD");
    else if (!/^\d{12}$/.test(idNumber)) errors.push("CCCD phải đủ 12 số");

    const place = matchWard(input.address, wardBook);
    if (typeof place === "string") errors.push(place);

    const code = normalizeSocialCode(input.socialInsuranceCode);
    const root = rootOf.get(idNumber) ?? null;
    const codeOwner = code ? ownerOfCode.get(code) : undefined;
    if (code && root?.socialInsuranceCode && root.socialInsuranceCode !== code)
      errors.push(`Mã số BHXH khác mã đã lưu ở hồ sơ khách (${root.socialInsuranceCode})`);
    else if (codeOwner && codeOwner !== root?.id) errors.push(`Mã số BHXH ${code} đã thuộc khách khác`);
    if (code && /^\d{12}$/.test(idNumber)) {
      const earlier = codeInFile.get(idNumber);
      const otherIdNumber = idNumberOfCode.get(code);
      if (earlier && earlier !== code) errors.push(`Mã số BHXH khác dòng trên của cùng khách (${earlier})`);
      else if (otherIdNumber && otherIdNumber !== idNumber)
        errors.push(`Mã số BHXH ${code} trùng với khách khác trong file`);
      else {
        codeInFile.set(idNumber, code);
        idNumberOfCode.set(code, idNumber);
      }
    }

    if (partial.receiptMonth && /^\d{12}$/.test(idNumber)) {
      const key = `${idNumber}|${partial.receiptMonth}`;
      const earlier = firstRowOf.get(key);
      if (earlier !== undefined)
        errors.push(`Trùng dòng ${earlier}: cùng khách, cùng tháng biên lai`);
      else firstRowOf.set(key, input.row);
      if (root && takenKeys.has(`${root.id}|${partial.receiptMonth}`))
        errors.push(`Khách đã có hồ sơ ${KIND_LABEL[kind]} tháng ${monthLabel(partial.receiptMonth)}`);
    }

    preview.push({
      row: input.row,
      fullName,
      idNumberTail: /^\d{12}$/.test(idNumber) ? tail(idNumber) : "",
      receiptMonth: partial.receiptMonth ?? "",
      customer: /^\d{12}$/.test(idNumber) ? (root ? "existing" : "new") : null,
      wardName: typeof place === "string" ? "" : place.ward.name,
      staffName: partial.staff?.fullName ?? "",
      plan: partial.plan ?? null,
      months: partial.months ?? null,
      collectedCents: partial.collectedCents ?? null,
      paidCents: partial.paidCents ?? null,
      errors,
    });
    if (errors.length === 0 && entry && typeof place !== "string")
      parsed.push({
        row: input.row,
        fullName: capitalizePersonName(fullName),
        idNumber,
        address: place.address,
        ward: place.ward,
        socialInsuranceCode: code,
        entry,
        customerRootId: root?.id ?? null,
      });
  }

  return { preview, parsed };
}

/** Sau khi ghi hoặc xoá lượt nhập liệu: điểm dịch vụ và ngày công của nhân viên ATM. */
export async function recomputeEntryStaff(staffIds: string[], serviceDate: string): Promise<void> {
  for (const staffId of new Set(staffIds)) {
    await recomputeKpi(staffId, serviceDate.slice(0, 7));
    await recomputeEmployeeWorkDay(staffId, serviceDate);
  }
}

/** Sau khi ghi, sửa hoặc xoá dòng: điểm An Sinh của người tải file theo tháng biên lai. */
export async function recomputeUploader(uploaderId: string, receiptMonths: string[]): Promise<void> {
  for (const month of new Set(receiptMonths)) await recomputeKpi(uploaderId, month);
}

/**
 * Nhập file 1. `commit: false` chỉ kiểm. `commit: true` kiểm lại trong
 * transaction, có một dòng lỗi là từ chối cả file (chốt 2026-10-04).
 *
 * Lượt nhập liệu của nhân viên ATM lấy ngày tải file. Khách mới mang kênh ATM,
 * không ngày sinh, người lập là nhân viên ATM ở cột NHẬP LIỆU. Xã ở cột ĐỊA CHỈ
 * phải có trong danh mục của tỉnh đã chọn.
 */
export async function importRecords(
  actor: User,
  request: RecordImportRequest,
): Promise<Outcome<RecordImportResult>> {
  const serviceDate = businessDay();
  const typeId = await dataEntryTypeId(request.kind, db);
  if (!typeId)
    return { ok: false, message: `Danh mục chưa có loại dịch vụ "${DATA_ENTRY_TYPE_NAME[request.kind]}".` };
  const closedToday = await closedMonthAmong([serviceDate.slice(0, 7)]);
  if (closedToday) return { ok: false, message: closedMonthMessage(closedToday) };
  const wardBook = await wardBookOf(request.provinceId, db);
  if (!wardBook) return { ok: false, message: "Không tìm thấy tỉnh/thành phố này." };

  if (!request.commit) {
    const { preview } = await checkRecords(db, request.kind, wardBook, request.rows);
    return { ok: true, result: { rows: preview, written: 0 } };
  }

  const outcome = await db.transaction(async (tx) => {
    await lockSocialInsurance(tx);
    const { preview, parsed } = await checkRecords(tx, request.kind, wardBook, request.rows);
    const errorRows = preview.filter((r) => r.errors.length > 0).length;
    if (errorRows > 0) return { ok: false as const, errorRows };

    const [channel] = await tx
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.code, ATM_CHANNEL_CODE))
      .limit(1);
    const collaboratorOf = await collaboratorIds(
      parsed.map((p) => p.entry.collaborator),
      tx,
    );

    const createdRoot = new Map<string, string>();
    const codedRoots = new Set<string>();
    for (const p of parsed) {
      let rootId = p.customerRootId ?? createdRoot.get(p.idNumber) ?? null;
      if (!rootId) {
        rootId = crypto.randomUUID();
        await tx.insert(customers).values({
          id: rootId,
          rootCustomerId: rootId,
          seq: 1,
          fullName: p.fullName,
          dob: null,
          idNumber: p.idNumber,
          address: p.address,
          channelId: channel?.id ?? null,
          channelDetail: "",
          socialInsuranceCode: p.socialInsuranceCode || null,
          createdBy: p.entry.staff.id,
          createdByDepartmentId: p.entry.staff.departmentId,
        });
        createdRoot.set(p.idNumber, rootId);
        if (p.socialInsuranceCode) codedRoots.add(rootId);
      } else if (p.socialInsuranceCode && !codedRoots.has(rootId)) {
        // Mã số BHXH là của người, nên chép sang MỌI lần mở hồ sơ của khách.
        await tx
          .update(customers)
          .set({ socialInsuranceCode: p.socialInsuranceCode })
          .where(and(eq(customers.rootCustomerId, rootId), sql`${customers.socialInsuranceCode} is null`));
        codedRoots.add(rootId);
      }

      const [service] = await tx
        .insert(services)
        .values({
          customerId: rootId,
          serviceTypeId: typeId,
          note: "",
          serviceDate,
          createdBy: p.entry.staff.id,
          createdByDepartmentId: p.entry.staff.departmentId,
          wardId: p.ward.id,
          wardName: p.ward.name,
        })
        .returning({ id: services.id });
      await tx.insert(socialInsuranceRecords).values({
        kind: request.kind,
        customerId: rootId,
        receiptMonth: p.entry.receiptMonth,
        plan: p.entry.plan,
        months: p.entry.months,
        collectedAmount: decimalFromCents(p.entry.collectedCents),
        paidAmount: decimalFromCents(p.entry.paidCents),
        collaboratorId: p.entry.collaborator ? (collaboratorOf.get(p.entry.collaborator) ?? null) : null,
        serviceId: service.id,
        entryStaffId: p.entry.staff.id,
        uploadedBy: actor.id,
        uploadedByDepartmentId: actor.departmentId,
      });
    }
    return {
      ok: true as const,
      preview,
      staffIds: parsed.map((p) => p.entry.staff.id),
      receiptMonths: parsed.map((p) => p.entry.receiptMonth),
    };
  });

  if (!outcome.ok)
    return { ok: false, message: `File còn ${outcome.errorRows} dòng lỗi.` };
  await recomputeEntryStaff(outcome.staffIds, serviceDate);
  await recomputeUploader(actor.id, outcome.receiptMonths);
  return { ok: true, result: { rows: outcome.preview, written: outcome.staffIds.length } };
}

type ReconcileMatch = { recordId: string; values: ReconcileValues };
type ReconcileValues = {
  plan: SocialInsurancePlan;
  months: number;
  collectedCents: number;
  receivedCents: number;
  receivedRate: number;
};

/**
 * Kiểm file 2. Mỗi dòng khớp đúng một dòng file 1 theo loại, khách, tháng biên
 * lai. Khách tra theo CCCD, không ra thì theo mã số BHXH. File 2 khác file 1
 * thì không phải lỗi: đó là chỗ file 1 nhập sai, trang tô ô lệch.
 */
async function checkReconciliation(
  conn: Conn,
  kind: SocialInsuranceKind,
  rows: ReconcileFileRow[],
  scope: SQL | undefined,
): Promise<{ preview: ReconcilePreviewRow[]; matches: ReconcileMatch[] }> {
  const identities = rows.map((r) => r.identity.replace(/\s/g, ""));
  const idNumbers = [...new Set(identities.map(normalizeIdNumber).filter((v) => /^\d{12}$/.test(v)))];
  const codes = [...new Set(identities.map(normalizeSocialCode).filter(Boolean))];

  const byIdNumber = idNumbers.length
    ? await conn
        .select({ id: customers.id, idNumber: customers.idNumber })
        .from(customers)
        .where(and(inArray(customers.idNumber, idNumbers), sql`${customers.rootCustomerId} = ${customers.id}`))
    : [];
  const byCode = codes.length
    ? await conn
        .select({ id: customers.id, code: customers.socialInsuranceCode })
        .from(customers)
        .where(
          and(inArray(customers.socialInsuranceCode, codes), sql`${customers.rootCustomerId} = ${customers.id}`),
        )
    : [];
  const rootOfIdNumber = new Map(byIdNumber.map((r) => [r.idNumber ?? "", r.id]));
  const rootOfCode = new Map(byCode.map((r) => [r.code ?? "", r.id]));

  const rootIds = [...new Set([...rootOfIdNumber.values(), ...rootOfCode.values()])];
  const records = rootIds.length
    ? await conn
        .select({
          id: socialInsuranceRecords.id,
          customerId: socialInsuranceRecords.customerId,
          receiptMonth: socialInsuranceRecords.receiptMonth,
          plan: socialInsuranceRecords.plan,
          months: socialInsuranceRecords.months,
          collectedAmount: socialInsuranceRecords.collectedAmount,
          paidAmount: socialInsuranceRecords.paidAmount,
        })
        .from(socialInsuranceRecords)
        .where(
          and(eq(socialInsuranceRecords.kind, kind), inArray(socialInsuranceRecords.customerId, rootIds), scope),
        )
    : [];
  const recordOf = new Map(records.map((r) => [`${r.customerId}|${r.receiptMonth}`, r]));

  const months = rows.map((r) => parseReceiptMonth(r.receiptDate)).filter((m): m is string => m !== null);
  const rateBooks = await rateBooksFor(months, conn);

  const firstRowOf = new Map<string, number>();
  const preview: ReconcilePreviewRow[] = [];
  const matches: ReconcileMatch[] = [];

  for (const [i, input] of rows.entries()) {
    const errors: string[] = [];
    const differences: string[] = [];
    const identity = identities[i];
    const idNumber = normalizeIdNumber(identity);

    const receiptMonth = parseReceiptMonth(input.receiptDate);
    if (!receiptMonth) errors.push("Ngày biên lai phải có dạng mm/yyyy");
    const plan = parsePlan(input.plan);
    if (!plan) errors.push("Phương án phải là Tăng mới hoặc Tái tục");
    const monthsText = input.months.trim();
    const monthCount =
      /^\d+$/.test(monthsText) && Number(monthsText) > 0 && Number(monthsText) <= MAX_MONTHS
        ? Number(monthsText)
        : null;
    if (monthCount === null) errors.push(`Số tháng phải là số nguyên từ 1 tới ${MAX_MONTHS}`);
    const collected = parseMoneyCents(input.collected);
    const collectedCents = typeof collected === "number" && collected > 0 ? collected : null;
    if (collectedCents === null) errors.push("Số tiền thu phải là số lớn hơn 0");
    const received = parseMoneyCents(input.received);
    const receivedCents = typeof received === "number" ? received : null;
    if (receivedCents === null) errors.push("Số tiền nhận phải là số");
    const rateValue = parseRate(input.receivedRate);
    const receivedRate = typeof rateValue === "number" ? rateValue : null;
    if (receivedRate === null) errors.push("% HH nhận phải là số");

    if (!identity) errors.push("Thiếu CCCD hoặc mã số BHXH");
    const rootId = rootOfIdNumber.get(idNumber) ?? rootOfCode.get(normalizeSocialCode(identity)) ?? null;
    const record = rootId && receiptMonth ? recordOf.get(`${rootId}|${receiptMonth}`) : undefined;
    if (identity && receiptMonth && !record)
      errors.push(`Không tìm thấy hồ sơ ${KIND_LABEL[kind]} tháng ${monthLabel(receiptMonth)} của khách này`);

    if (record) {
      const earlier = firstRowOf.get(record.id);
      if (earlier !== undefined) errors.push(`Trùng dòng ${earlier}: cùng khách, cùng tháng biên lai`);
      else firstRowOf.set(record.id, input.row);
    }

    if (receiptMonth && plan && monthCount !== null && collectedCents !== null) {
      const rate = rateBooks.get(receiptMonth)?.get(kind, plan, monthCount);
      if (!rate)
        errors.push(
          `Chưa cấu hình % hoa hồng cho ${KIND_LABEL[kind]} ${PLAN_LABEL[plan]} ${monthCount} tháng, tháng ${monthLabel(receiptMonth)}`,
        );
      else {
        if (receivedRate !== null && receivedRate !== rate.receiveRate)
          errors.push(`% HH nhận phải là ${formatRate(rate.receiveRate)}`);
        const expected = applyRate(collectedCents, rate.receiveRate);
        if (receivedCents !== null && receivedCents !== expected)
          errors.push(
            `Số tiền nhận phải là ${formatCents(expected)} (${formatRate(rate.receiveRate)} × ${formatCents(collectedCents)})`,
          );
      }
    }

    if (record && plan && monthCount !== null && collectedCents !== null) {
      if (record.plan !== plan)
        differences.push(`Phương án: hồ sơ ghi ${PLAN_LABEL[record.plan]}, đối chiếu ghi ${PLAN_LABEL[plan]}`);
      if (record.months !== monthCount)
        differences.push(`Số tháng: hồ sơ ghi ${record.months}, đối chiếu ghi ${monthCount}`);
      const recordCents = centsFromDecimal(record.collectedAmount);
      if (recordCents !== collectedCents)
        differences.push(`Tiền thu: hồ sơ ghi ${formatCents(recordCents)}, đối chiếu ghi ${formatCents(collectedCents)}`);
      const payRate = receiptMonth ? rateBooks.get(receiptMonth)?.get(kind, plan, monthCount)?.payRate : undefined;
      const recordPaid = centsFromDecimal(record.paidAmount);
      if (payRate !== undefined && applyRate(collectedCents, payRate) !== recordPaid)
        differences.push(
          `Tiền chi: hồ sơ ghi ${formatCents(recordPaid)}, đối chiếu tính ra ${formatCents(applyRate(collectedCents, payRate))}`,
        );
    }

    preview.push({
      row: input.row,
      fullName: input.fullName.trim(),
      identity: /^\d{12}$/.test(idNumber) ? `…${tail(idNumber)}` : identity,
      receiptMonth: receiptMonth ?? "",
      plan,
      months: monthCount,
      collectedCents,
      receivedCents,
      receivedRate,
      errors,
      differences,
    });
    if (errors.length === 0 && record && plan && monthCount !== null && collectedCents !== null && receivedCents !== null && receivedRate !== null)
      matches.push({
        recordId: record.id,
        values: { plan, months: monthCount, collectedCents, receivedCents, receivedRate },
      });
  }

  return { preview, matches };
}

/**
 * Nhập file 2. Ghi đè 4 cột đối chiếu mỗi lần tải. Nhận cả tháng đã chốt lương:
 * file 2 không đổi điểm, không đổi lương.
 */
export async function importReconciliation(
  actor: User,
  request: ReconcileImportRequest,
): Promise<Outcome<ReconcileImportResult>> {
  const scope = recordScopeWhere(recordVisibility(actor, "social-insurance", "create"));
  if (!request.commit) {
    const { preview } = await checkReconciliation(db, request.kind, request.rows, scope);
    return { ok: true, result: { rows: preview, written: 0 } };
  }

  const outcome = await db.transaction(async (tx) => {
    await lockSocialInsurance(tx);
    const { preview, matches } = await checkReconciliation(tx, request.kind, request.rows, scope);
    const errorRows = preview.filter((r) => r.errors.length > 0).length;
    if (errorRows > 0) return { ok: false as const, errorRows };
    for (const m of matches)
      await tx
        .update(socialInsuranceRecords)
        .set({
          reconciledPlan: m.values.plan,
          reconciledMonths: m.values.months,
          reconciledCollectedAmount: decimalFromCents(m.values.collectedCents),
          receivedAmount: decimalFromCents(m.values.receivedCents),
          receivedRate: m.values.receivedRate,
          reconciledAt: new Date(),
          reconciledBy: actor.id,
        })
        .where(eq(socialInsuranceRecords.id, m.recordId));
    return { ok: true as const, preview, written: matches.length };
  });

  if (!outcome.ok)
    return { ok: false, message: `File còn ${outcome.errorRows} dòng lỗi.` };
  return { ok: true, result: { rows: outcome.preview, written: outcome.written } };
}
