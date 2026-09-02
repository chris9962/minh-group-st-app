import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { canEditOpeningPhotos, MAX_BANK_ACCOUNTS_PER_CUSTOMER } from "@/lib/api/bankAccounts";
import type {
  BankAccount,
  BankAccountFinishForm,
  BankAccountStartForm,
  BankAccountStatusUpdateForm,
  BankAccountUpdateForm,
  CustomerBankSlots,
  PhotoKind,
} from "@/lib/api/bankAccounts";
import type { BankAccountDetail, BankAccountRow, BankAccountSort } from "@/lib/api/banking";
import type { Page } from "@/lib/api/pagination";
import type { BankPhoto, BankPhotoRow } from "@/lib/api/bankPhotos";
import { businessDay, businessMonth } from "@/lib/format";
import { recordVisibility, type RecordVisibility } from "@/lib/permissions";
import { isRealIsoDate, type User } from "@/lib/types";
import { db } from "./db/client";
import { departmentForNewRecord } from "./writeDepartment";
import {
  bankAccountPhotos,
  bankAccounts,
  bankGuidePhotos,
  bankGuideVariants,
  banks,
  channels,
  customerPhones,
  customers,
  departments,
  referralCodeDepartments,
  referralCodes,
  users,
} from "./db/schema";
import { recomputeGiftCase } from "./gift";
import { recomputeKpiForCustomer } from "./kpi";
import type { PageArgs } from "./pagination";
import { imageUrl } from "./storage";

/**
 * P-20 · P-21 · P-22 — bản DB của module ngân hàng.
 *
 * Hệ thống KHÔNG mở tài khoản, chỉ ghi nhận. Luồng hai bước (spec §4.2): bước 1
 * chọn khách + ngân hàng + mã và GIỮ CHỖ ngay; bước 2 quay lại điền số tài
 * khoản, ngày mở, ảnh chứng minh rồi mới Hoàn thành — lúc đó mã mới thật sự bị
 * tiêu và điểm KPI mới tính.
 */

/** Vô hiệu ký tự đại diện của `LIKE` — gõ `%` phải ra "không có kết quả". */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Ngày lọc phải ĐÚNG HÌNH DẠNG và CÓ THẬT.
 *
 * Bản cũ chỉ so regex `^\d{4}-\d{2}-\d{2}$`. `2026-02-30` khớp hình dạng đó
 * nhưng tháng 2 không có ngày 30, nên Postgres từ chối bằng `22008` và cả màn
 * trả 500. Khoảng ngày nằm trong địa chỉ trang, nên một link cũ bị sửa là đủ.
 *
 * Ngày sai thì BỎ QUA điều kiện lọc đó, không trả 400 — cùng lối nghĩ với
 * `uuidParam`.
 */
const usableDate = isRealIsoDate;

type BankAgeRule = { minAge: number | null; maxAge: number | null };

/** Tuổi tròn theo ngày làm việc Việt Nam, không tính năm sinh đơn thuần. */
function ageOn(dob: string, at: string): number | null {
  if (!isRealIsoDate(dob) || !isRealIsoDate(at)) return null;
  const [birthYear, birthMonth, birthDay] = dob.split("-").map(Number);
  const [year, month, day] = at.split("-").map(Number);
  return year - birthYear - (month < birthMonth || (month === birthMonth && day < birthDay) ? 1 : 0);
}

function meetsBankAgeRule(dob: string | null, rule: BankAgeRule, at = businessDay()): boolean {
  if (rule.minAge === null && rule.maxAge === null) return true;
  if (!dob) return false;
  const age = ageOn(dob, at);
  return age !== null && (rule.minAge === null || age >= rule.minAge) && (rule.maxAge === null || age <= rule.maxAge);
}

function ageRuleLabel(rule: BankAgeRule): string {
  if (rule.minAge !== null && rule.maxAge !== null) return `${rule.minAge}–${rule.maxAge} tuổi`;
  if (rule.minAge !== null) return `từ ${rule.minAge} tuổi`;
  return `tối đa ${rule.maxAge} tuổi`;
}

export type BankAccountFilters = {
  search: string;
  bankCode: string;
  from: string;
  to: string;
  referralCode: string;
  channelId: string;
  staffId: string;
  status: string;
};

/**
 * Phạm vi bản ghi theo ĐÚNG hành động đang làm.
 *
 * `chỉ mình` ở đây là "tài khoản do chính mình mở" (spec §1.1.2), không phải cả
 * phòng — xem ghi chú ở `recordVisibility`.
 */
const scopeOf = (
  actor: User,
  action: "view-detail" | "create" | "update" | "delete" | "export",
) => recordVisibility(actor, "banking", action);

/**
 * Điều kiện SQL tương ứng. `undefined` = không lọc; `false` = không thấy gì.
 */
const scopeWhere = (v: RecordVisibility): SQL | undefined => {
  switch (v.kind) {
    case "all":
      return undefined;
    case "departments":
      return inArray(bankAccounts.createdByDepartmentId, v.departmentIds);
    case "creator":
      return eq(bankAccounts.createdBy, v.userId);
    default:
      return sql`false`;
  }
};

/**
 * BƯỚC 2 và ẢNH gác bằng `banking:update`.
 *
 * Bản đầu tiên gác bằng `create` vì dữ liệu phân quyền lúc đó KHÔNG CẤP
 * `banking:update` cho bất kỳ ai — gác đúng thì cả module đứng im. Cách chữa
 * đúng là bổ sung quyền còn thiếu (`lib/roles.ts` + `scripts/db-grant-missing-permissions.ts`),
 * không phải bẻ cong đường cắt phân quyền cho vừa dữ liệu sai.
 */
const WRITE_ACTION = "update" as const;

const inScope = (
  v: RecordVisibility,
  row: { createdById: string | null; createdByDepartmentId: string | null },
): boolean => {
  switch (v.kind) {
    case "all":
      return true;
    case "departments":
      return (
        row.createdByDepartmentId !== null &&
        v.departmentIds.includes(row.createdByDepartmentId)
      );
    case "creator":
      return row.createdById === v.userId;
    default:
      return false;
  }
};

/**
 * Tìm theo TÊN KHÁCH bằng `exists`, không phải phép nối.
 *
 * `exists` là phép nửa-nối: Postgres dừng ngay khi thấy một dòng khớp, và cột
 * sinh `customers.search_name` có chỉ mục trigram đỡ. Nối `customers` vào câu
 * chọn trang thì bảng khách đi cùng suốt phép sắp xếp trên bảng LỚN NHẤT hệ
 * thống (AGENTS.md §5.2).
 */
function searchWhere(raw: string): SQL | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  return and(
    ...text.split(/\s+/).map(
      (term) =>
        sql`exists (
          select 1 from ${customers} c
          where c.id = ${bankAccounts.customerId}
            and c.search_name like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'
        )`,
    ),
  );
}

/**
 * Đổi MÃ (chuỗi người dùng thấy) thành ID trước khi lọc trên bảng lớn.
 *
 * Hai bảng tra cứu này chỉ vài chục tới vài trăm dòng, quét chúng gần như miễn
 * phí. Ngược lại — nhét `exists (select … where rc.code = …)` vào câu chính —
 * là chạy phép nửa-nối cho TỪNG dòng tài khoản ứng viên, trên bảng phình theo
 * ngày làm việc.
 *
 * Trả `[]` khi mã không tồn tại, và nơi gọi hiểu `[]` là "không dòng nào khớp"
 * chứ không phải "bỏ qua bộ lọc" — gõ mã sai phải ra bảng trống, không phải ra
 * cả kho.
 */
async function bankIdsOf(code: string): Promise<string[] | null> {
  if (!code) return null;
  const rows = await db.select({ id: banks.id }).from(banks).where(eq(banks.code, code));
  return rows.map((r) => r.id);
}

async function referralCodeIdsOf(code: string): Promise<string[] | null> {
  if (!code) return null;
  // Hai ngân hàng được phép trùng tên mã (khoá duy nhất là bank + code), nên
  // một chuỗi có thể ứng với nhiều id.
  const rows = await db
    .select({ id: referralCodes.id })
    .from(referralCodes)
    .where(eq(referralCodes.code, code));
  return rows.map((r) => r.id);
}

/** Chuỗi rỗng hoặc giá trị lạ đều thành "mọi trạng thái". */
const statusFilter = (raw: string): SQL | undefined =>
  raw === "creating" || raw === "done" || raw === "error"
    ? eq(bankAccounts.status, raw)
    : undefined;

async function accountFilters(
  visible: RecordVisibility,
  query: BankAccountFilters,
): Promise<SQL | undefined> {
  const [bankIds, codeIds] = await Promise.all([
    bankIdsOf(query.bankCode),
    referralCodeIdsOf(query.referralCode),
  ]);

  const parts = [
    scopeWhere(visible),
    searchWhere(query.search),
    // `[]` = mã gõ vào không có thật → không dòng nào khớp. `sql\`false\`` nói
    // đúng điều đó; bỏ qua bộ lọc thì người dùng gõ sai mã lại thấy cả kho.
    bankIds === null ? undefined : bankIds.length > 0 ? inArray(bankAccounts.bankId, bankIds) : sql`false`,
    codeIds === null
      ? undefined
      : codeIds.length > 0
        ? inArray(bankAccounts.referralCodeId, codeIds)
        : sql`false`,
    // Ngày sai định dạng thì bỏ qua, không trả 400 — link cũ hay ô địa chỉ gõ
    // nhầm không đáng làm hỏng cả màn (cùng lối nghĩ với `uuidParam`).
    usableDate(query.from) ? gte(bankAccounts.openedDate, query.from) : undefined,
    usableDate(query.to) ? lte(bankAccounts.openedDate, query.to) : undefined,
    query.channelId ? eq(bankAccounts.channelId, query.channelId) : undefined,
    query.staffId ? eq(bankAccounts.createdBy, query.staffId) : undefined,
    statusFilter(query.status),
  ].filter(Boolean) as SQL[];

  return parts.length > 0 ? and(...parts) : undefined;
}

/**
 * Chọn ra ĐÚNG những dòng của trang này, chỉ đụng bảng `bank_accounts`.
 *
 * Lọc, sắp và cắt trang xong hết ở đây rồi mới đi lấy tên khách, mã ngân hàng,
 * mã giới thiệu, tên người tạo và tên phòng. Năm phép nối đó chạy trên 15 dòng,
 * không phải trên cả kho.
 */
const pickPage = (where: SQL | undefined, orderBy: SQL[], limit: number, offset: number) =>
  db
    .select({
      id: bankAccounts.id,
      customerId: bankAccounts.customerId,
      bankId: bankAccounts.bankId,
      referralCodeId: bankAccounts.referralCodeId,
      accountNumber: bankAccounts.accountNumber,
      openedDate: bankAccounts.openedDate,
      transactionAt: bankAccounts.transactionAt,
      // Không hiện ở màn nào — có mặt CHỈ để câu ngoài sắp lại được, xem `orderOuter`.
      createdAt: bankAccounts.createdAt,
      channelId: bankAccounts.channelId,
      channelDetail: bankAccounts.channelDetail,
      appInstalled: bankAccounts.appInstalled,
      accountType: bankAccounts.accountType,
      note: bankAccounts.note,
      errorNote: bankAccounts.errorNote,
      createdBy: bankAccounts.createdBy,
      createdByDepartmentId: bankAccounts.createdByDepartmentId,
      // Mốc tính cửa sổ sửa ảnh chứng minh (`canEditOpeningPhotos`).
      finishedAt: bankAccounts.finishedAt,
      status: bankAccounts.status,
    })
    .from(bankAccounts)
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
      bankId: page.bankId,
      bankCode: banks.code,
      referralCodeId: page.referralCodeId,
      // Lịch sử tài khoản phải đọc được cả với mã QR-only.
      referralCode: referralCodes.displayName,
      // Bản ghi trước migration 0056 chưa chụp loại tài khoản vào chính đơn.
      // Mã đã được dùng không đổi loại được, nên đây là nguồn dự phòng an toàn
      // để màn chi tiết vẫn hiện đúng CNKD/HKD cho dữ liệu cũ.
      referralAccountType: referralCodes.accountType,
      // Dữ liệu link cũ còn trả về để tương thích bản ghi đã có; giao diện
      // không dùng nó để mở app.
      referralOpenUrl: sql<string>`coalesce(${referralCodes.openUrl}, '')`,
      // Khoá trần trong kho ảnh; `imageUrl` dựng đường đọc ở nơi trả ra.
      referralQrImage: referralCodes.qrImage,
      // Cột nullable ở DB nhưng hợp đồng là chuỗi: `''` lúc còn `creating` —
      // chưa mở xong thì chưa biết số thật.
      accountNumber: sql<string>`coalesce(${page.accountNumber}, '')`,
      date: sql<string>`coalesce(${page.openedDate}::text, '')`,
      transactionAt: sql<string>`coalesce(${page.transactionAt}::text, '')`,
      channel: sql<string>`coalesce(${channels.name}, '')`,
      channelDetail: page.channelDetail,
      appInstalled: page.appInstalled,
      accountType: page.accountType,
      note: page.note,
      errorNote: page.errorNote,
      createdById: page.createdBy,
      createdByName: users.fullName,
      createdByDepartmentId: page.createdByDepartmentId,
      // Không tốn thêm phép nối — `users` đã có mặt cho `createdByName`.
      createdByStaffCode: sql<string>`coalesce(${users.staffCode}, '')`,
      createdByDepartmentName: departments.name,
      finishedAt: page.finishedAt,
      status: page.status,
      requiredPhotos: banks.requiredPhotos,
      accountNumberMethod: banks.accountNumberMethod,
      accountNumberPrefix: banks.accountNumberPrefix,
      accountNumberLength: banks.accountNumberLength,
      // Hướng dẫn mở tài khoản của ngân hàng này (spec §4.4d). `''` = chưa có.
      bankGuide: sql<string>`coalesce(${banks.guide}, '')`,
    })
    .from(page)
    .innerJoin(customers, eq(customers.id, page.customerId))
    .innerJoin(banks, eq(banks.id, page.bankId))
    .innerJoin(referralCodes, eq(referralCodes.id, page.referralCodeId))
    // leftJoin cả ba: người tạo có thể đã bị xoá khỏi hệ thống, ban giám đốc
    // không thuộc phòng nào, và kênh là cột nullable. innerJoin thì những dòng
    // đó biến mất khỏi danh sách mà không báo gì.
    .leftJoin(users, eq(users.id, page.createdBy))
    .leftJoin(departments, eq(departments.id, page.createdByDepartmentId))
    .leftJoin(channels, eq(channels.id, page.channelId));

type DecoratedRow = Awaited<ReturnType<typeof decorate>>[number];

/** Loại đã chụp trên đơn; dữ liệu cũ chưa có thì đọc từ mã giới thiệu đã dùng. */
const accountTypeOf = (row: DecoratedRow) =>
  row.accountType === "none" ? row.referralAccountType : row.accountType;

const toRow = (r: DecoratedRow): BankAccountRow => ({
  id: r.id,
  customerId: r.customerId,
  customerName: r.customerName,
  bankCode: r.bankCode,
  accountNumber: r.accountNumber,
  referralCode: r.referralCode,
  channel: r.channel,
  appInstalled: r.appInstalled,
  date: r.date,
  createdById: r.createdById,
  createdByName: r.createdByName,
  createdByStaffCode: r.createdByStaffCode,
  createdByDepartmentName: r.createdByDepartmentName,
  status: r.status,
});

/**
 * Sắp theo ngày mở, NULL xuống cuối, ba khoá.
 *
 * Viết thẳng `desc nulls last` chứ không bọc `desc(sql\`… nulls last\`)`: bọc
 * thì drizzle nối thành `opened_date nulls last desc`, mà Postgres đòi đúng thứ
 * tự `desc nulls last` — sai là lỗi cú pháp, không phải sắp nhầm.
 *
 * `nulls last` là cố ý: tài khoản còn `creating` chưa có ngày mở, mà mặc định
 * Postgres xếp NULL lên ĐẦU khi giảm dần — bảng mở ra toàn bản nháp trong khi
 * người dùng đang tìm tài khoản mới hoàn thành.
 *
 * `created_at` phá hoà (migration 0018). `opened_date` là kiểu `date`, không có
 * giờ, nên mọi tài khoản mở cùng ngày đều hoà — mà một ngày làm việc có hàng
 * chục dòng như vậy. Thiếu khoá này thì khoá phá hoà còn lại là `id`, uuid
 * NGẪU NHIÊN, và người vừa nhập xong không thấy dòng của mình đâu vì nó rơi vào
 * giữa bảng. Đơn bảo hiểm đã dính đúng lỗi này, xem `insurance.ts`.
 *
 * `id` vẫn đứng cuối: hai dòng sinh trong cùng một giao dịch mang `created_at` y
 * hệt nhau, vì `now()` không đổi trong một giao dịch.
 */
const orderByDate = (
  t: { date: SQLWrapper; at: SQLWrapper; id: SQLWrapper },
  dir: "asc" | "desc",
): SQL[] =>
  dir === "asc"
    ? [sql`${t.date} asc nulls last`, asc(t.at), asc(t.id)]
    : [sql`${t.date} desc nulls last`, desc(t.at), asc(t.id)];

/**
 * Một trang ĐÃ sắp đúng ở CẢ HAI TẦNG — mọi nơi cần danh sách phải đi qua đây.
 *
 * ⚠️ PHÉP NỐI KHÔNG GIỮ THỨ TỰ. Câu con sắp xong rồi cắt trang, nhưng câu ngoài
 * nối thêm sáu bảng — Postgres chọn Hash Join thì nó xây bảng băm rồi quét, thứ
 * tự đầu vào biến mất sạch. Đo trên chính dữ liệu thật: câu con trả
 * `15-15-14-14-13…`, sau khi nối thành `11-11-12-13-13…`, đảo ngược hoàn toàn.
 *
 * Bỏ `ORDER BY` ở câu ngoài KHÔNG phải tối ưu — SQL không hứa giữ thứ tự qua
 * phép nối, và nó "chạy đúng" khi ít dữ liệu chỉ vì Postgres tình cờ chọn
 * Nested Loop. Thêm dòng vào là kế hoạch đổi và bảng loạn.
 *
 * Câu ngoài chỉ sắp 15 dòng đã cắt sẵn nên không tốn gì đáng kể.
 *
 * Hai tầng gọi CHUNG một `orderByDate`, chỉ khác nguồn cột. Chép quy tắc ra hai
 * chỗ là có ngày chúng lệch nhau — đúng lỗi đã xảy ra ở `server/audit.ts`.
 */
const orderedPage = (
  where: SQL | undefined,
  dir: "asc" | "desc",
  limit: number,
  offset: number,
) => {
  const page = pickPage(
    where,
    orderByDate(
      { date: bankAccounts.openedDate, at: bankAccounts.createdAt, id: bankAccounts.id },
      dir,
    ),
    limit,
    offset,
  );
  return decorate(page).orderBy(
    ...orderByDate({ date: page.openedDate, at: page.createdAt, id: page.id }, dir),
  );
};

/** MỘT trang tài khoản, đã lọc/tìm/sắp sẵn ở máy chủ (AGENTS.md §5.1). */
export async function listBankAccounts(
  actor: User,
  filters: BankAccountFilters,
  page: PageArgs<BankAccountSort>,
): Promise<Page<BankAccountRow>> {
  const visible = scopeOf(actor, "view-detail");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = await accountFilters(visible, filters);
  const [rows, [totals]] = await Promise.all([
    orderedPage(where, page.dir, page.limit, page.offset),
    db.select({ value: count() }).from(bankAccounts).where(where),
  ]);

  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

/**
 * MỘT trang tài khoản của ĐÚNG một ngân hàng — trang chi tiết ngân hàng (P-60).
 *
 * KHÔNG kẹp phạm vi phòng hay người tạo, khác `listBankAccounts`. Người được
 * giao quản một ngân hàng phải đọc được mọi tài khoản của ngân hàng đó để đối
 * chiếu với ngân hàng, kể cả tài khoản do phòng khác mở (chốt 2026-09-01).
 *
 * ⚠️ Vì bỏ phạm vi nên chốt duy nhất là `canManageBank` ở route. Gọi hàm này ở
 * chỗ khác mà quên chốt đó là mở cả kho tài khoản cho người không được xem.
 */
export type BankOfBankFilters = {
  from: string;
  to: string;
  status: string;
  referralCodeId: string;
  /** Phòng GHI NHẬN lúc tạo bản ghi, chụp một lần (spec §1.1.5). */
  departmentId: string;
};

/** Bảng trên màn và file Excel dùng CHUNG điều kiện này — hai bản là hai kết quả. */
const bankAccountsOfBankWhere = (bankId: string, filters: BankOfBankFilters): SQL =>
  and(
    eq(bankAccounts.bankId, bankId),
    ...([
      usableDate(filters.from) ? gte(bankAccounts.openedDate, filters.from) : undefined,
      usableDate(filters.to) ? lte(bankAccounts.openedDate, filters.to) : undefined,
      statusFilter(filters.status),
      // Lọc theo ID, không theo mã text: mã QR-only để trống cột `code`.
      filters.referralCodeId
        ? eq(bankAccounts.referralCodeId, filters.referralCodeId)
        : undefined,
      filters.departmentId
        ? eq(bankAccounts.createdByDepartmentId, filters.departmentId)
        : undefined,
    ].filter(Boolean) as SQL[]),
  )!;

export async function listBankAccountsOfBank(
  bankId: string,
  filters: BankOfBankFilters,
  page: PageArgs<BankAccountSort>,
): Promise<Page<BankAccountRow>> {
  const where = bankAccountsOfBankWhere(bankId, filters);

  const [rows, [totals]] = await Promise.all([
    orderedPage(where, page.dir, page.limit, page.offset),
    db.select({ value: count() }).from(bankAccounts).where(where),
  ]);

  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

/**
 * Trần một lượt xuất Excel. Chạm trần thì `total` nói ra sự thật và nơi gọi
 * BẮT BUỘC so hai số — file thiếu 5.000 dòng trông y hệt file đủ.
 */
export const EXPORT_LIMIT = 20_000;

/**
 * Trần một sheet Excel. KHÔNG phải trần do hệ thống đặt ra — quá số này thì
 * `exceljs` ghi ra một file Excel không mở được, chứ không phải file thiếu dòng.
 *
 * Trang chi tiết ngân hàng cố ý KHÔNG dùng `EXPORT_LIMIT`: bảng đã khoá theo
 * một ngân hàng và còn lọc thêm, mà người quản cần trọn kho để đối chiếu với
 * ngân hàng (chốt 2026-09-01).
 */
export const EXCEL_ROW_LIMIT = 1_048_575;

/**
 * TRỌN danh sách khớp bộ lọc của một ngân hàng, CHỈ cho việc xuất Excel.
 *
 * Đường riêng chứ không mở tham số "lấy hết" trên route đã phân trang
 * (AGENTS.md §5.1, điều 4). Phân quyền giống `listBankAccountsOfBank`: chốt là
 * `canManageBank` ở route.
 *
 * ⚠️ Toàn bộ kết quả nằm trong RAM của Node rồi mới dựng JSON. Chấp nhận được
 * vì phạm vi là một ngân hàng; đừng chép cách này sang danh sách toàn công ty.
 */
export async function listBankAccountsOfBankForExport(
  bankId: string,
  filters: BankOfBankFilters,
): Promise<Page<BankAccountRow>> {
  const where = bankAccountsOfBankWhere(bankId, filters);

  const [rows, [totals]] = await Promise.all([
    orderedPage(where, "desc", EXCEL_ROW_LIMIT, 0),
    db.select({ value: count() }).from(bankAccounts).where(where),
  ]);

  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

/**
 * Điều kiện SQL của một lượt xuất — phạm vi cộng bộ lọc, trả `null` khi người
 * gọi không thấy dòng nào.
 *
 * Mở ra cho `server/exports.ts` dùng chung. Chép luật phân quyền sang file khác
 * là mở đường cho hai nơi lệch nhau, mà lệch ở đây nghĩa là một báo cáo xuất ra
 * dòng của phòng khác.
 */
export async function accountExportWhere(
  actor: User,
  filters: BankAccountFilters,
): Promise<SQL | undefined | null> {
  const visible = scopeOf(actor, "export");
  if (visible.kind === "none") return null;
  return accountFilters(visible, filters);
}

export async function listBankAccountsForExport(
  actor: User,
  filters: BankAccountFilters,
): Promise<Page<BankAccountRow>> {
  // `export`, không phải `view-detail`: ai được cấp `view-detail` toàn công ty
  // nhưng `export` một phòng vẫn xuất được cả kho nếu kẹp nhầm vế.
  const visible = scopeOf(actor, "export");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = await accountFilters(visible, filters);
  const [rows, [totals]] = await Promise.all([
    orderedPage(where, "desc", EXPORT_LIMIT, 0),
    db.select({ value: count() }).from(bankAccounts).where(where),
  ]);

  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

/**
 * Tab Ảnh của trang chi tiết ngân hàng — MỘT trang tài khoản CÓ ảnh của đúng
 * một ngân hàng, mỗi dòng kèm TRỌN ảnh của nó.
 *
 * Cùng bộ lọc và cùng chốt phân quyền với `listBankAccountsOfBank`: KHÔNG kẹp
 * phạm vi phòng, chốt duy nhất là `canManageBank` ở route.
 *
 * Chỉ lấy tài khoản CÓ ảnh — lọc ở máy chủ, không phải cắt ở giao diện: cắt
 * sau khi phân trang là trang thưa dòng mà `total` vẫn đếm cả tài khoản trắng
 * ảnh. `exists` đi chỉ mục `bank_account_photos_account`. Ảnh của trang lấy
 * MỘT câu `in`, không truy vấn từng tài khoản (N+1, AGENTS.md §5.2).
 */
export async function listBankPhotos(
  bankId: string,
  filters: BankOfBankFilters,
  page: PageArgs<BankAccountSort>,
): Promise<Page<BankPhotoRow>> {
  const hasPhotos = sql`exists (
    select 1 from ${bankAccountPhotos} p where p.account_id = ${bankAccounts.id}
  )`;
  const where = and(bankAccountsOfBankWhere(bankId, filters), hasPhotos)!;

  const [rows, [totals]] = await Promise.all([
    orderedPage(where, page.dir, page.limit, page.offset),
    db.select({ value: count() }).from(bankAccounts).where(where),
  ]);

  const ids = rows.map((r) => r.id);
  const photoRows = ids.length
    ? await db
        .select({
          id: bankAccountPhotos.id,
          accountId: bankAccountPhotos.accountId,
          kind: bankAccountPhotos.kind,
          url: bankAccountPhotos.url,
        })
        .from(bankAccountPhotos)
        .where(inArray(bankAccountPhotos.accountId, ids))
        // `kind` sắp theo thứ tự khai enum: ảnh mở tài khoản đứng trước ảnh giao dịch.
        .orderBy(
          asc(bankAccountPhotos.kind),
          asc(bankAccountPhotos.sortOrder),
          asc(bankAccountPhotos.id),
        )
    : [];

  const photosByAccount = new Map<string, BankPhoto[]>();
  for (const p of photoRows) {
    const list = photosByAccount.get(p.accountId) ?? [];
    list.push({ id: p.id, url: imageUrl(p.url), kind: p.kind });
    photosByAccount.set(p.accountId, list);
  }

  return {
    rows: rows.map((r) => ({ ...toRow(r), photos: photosByAccount.get(r.id) ?? [] })),
    total: totals?.value ?? 0,
  };
}

/**
 * Dữ liệu dựng file zip cho ĐÚNG danh sách ảnh đã chọn: khoá trong kho ảnh
 * cộng các mảnh đặt tên file. Kẹp theo `bankId` — route so số dòng trả về với
 * số id đã gửi để từ chối ảnh của ngân hàng khác, không bỏ qua lặng lẽ.
 */
export async function photosForDownload(bankId: string, photoIds: string[]) {
  if (photoIds.length === 0) return [];
  return db
    .select({
      id: bankAccountPhotos.id,
      key: bankAccountPhotos.url,
      kind: bankAccountPhotos.kind,
      bankCode: banks.code,
      customerName: customers.fullName,
      accountNumber: sql<string>`coalesce(${bankAccounts.accountNumber}, '')`,
    })
    .from(bankAccountPhotos)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankAccountPhotos.accountId))
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(and(inArray(bankAccountPhotos.id, photoIds), eq(bankAccounts.bankId, bankId)));
}

/**
 * Ảnh của MỘT nhóm, đã đổi từ khoá trong database sang URL đọc được.
 *
 * Luôn phải kẹp `kind`: luật "đủ ảnh mới cho Hoàn thành" đếm riêng ảnh mở tài
 * khoản, lấy chung cả ảnh giao dịch thì tài khoản tự "đủ ảnh" sai.
 */
const photoUrlsOf = async (accountId: string, kind: PhotoKind): Promise<string[]> =>
  (
    await db
      .select({ url: bankAccountPhotos.url })
      .from(bankAccountPhotos)
      .where(and(eq(bankAccountPhotos.accountId, accountId), eq(bankAccountPhotos.kind, kind)))
      .orderBy(asc(bankAccountPhotos.sortOrder), asc(bankAccountPhotos.id))
  ).map((r) => imageUrl(r.url));

/**
 * Hình dạng mà `canEditOpeningPhotos` đọc — luật nằm ở `lib/api/bankAccounts.ts`
 * để giao diện và máy chủ dùng CHUNG một hàm, không chép luật ra hai nơi.
 */
const photoWindowOf = (r: DecoratedRow) => ({
  status: r.status,
  finishedAt: r.finishedAt?.toISOString() ?? "",
});

const rawById = async (id: string): Promise<DecoratedRow | null> =>
  (await decorate(pickPage(eq(bankAccounts.id, id), [], 1, 0)))[0] ?? null;

/** Dạng đầy đủ mà các endpoint GHI trả về (hợp đồng `BankAccount`). */
/**
 * Mọi số điện thoại của khách, SỐ CHÍNH đứng đầu.
 *
 * Ngân hàng có `cách lấy STK = trùng SĐT` thì số tài khoản chính là một trong
 * các số này — nhưng KHÔNG nhất thiết là số chính: khách mở tài khoản bằng số
 * phụ là chuyện thường. Trả cả danh sách để bước 2 cho người nhập chọn, thay vì
 * áp cứng số chính rồi ghi sai số tài khoản vào hợp đồng.
 */
async function customerPhoneNumbers(customerId: string): Promise<string[]> {
  const rows = await db
    .select({ number: customerPhones.number, isPrimary: customerPhones.isPrimary })
    .from(customerPhones)
    .where(eq(customerPhones.customerId, customerId));

  return rows
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((r) => r.number);
}

async function accountById(id: string): Promise<BankAccount | null> {
  const r = await rawById(id);
  if (!r) return null;
  return {
    id: r.id,
    customerId: r.customerId,
    customerName: r.customerName,
    bankId: r.bankId,
    bankCode: r.bankCode,
    referralCodeId: r.referralCodeId,
    referralCode: r.referralCode,
    referralOpenUrl: r.referralOpenUrl,
    referralQrUrl: r.referralQrImage ? imageUrl(r.referralQrImage) : "",
    accountNumber: r.accountNumber,
    openedDate: r.date,
    channel: r.channel,
    channelDetail: r.channelDetail,
    appInstalled: r.appInstalled,
    accountType: accountTypeOf(r),
    note: r.note,
    errorNote: r.errorNote,
    createdById: r.createdById,
    createdByName: r.createdByName,
    createdByDepartmentId: r.createdByDepartmentId,
    photoUrls: await photoUrlsOf(id, "opening"),
    transactionAt: r.transactionAt,
    transactionPhotoUrls: await photoUrlsOf(id, "transaction"),
    customerPhones: await customerPhoneNumbers(r.customerId),
    status: r.status,
  };
}

/**
 * P-22 · Chi tiết một tài khoản.
 *
 * Ngoài tầm nhìn trả `null` (route đổi thành 404) chứ không phải 403 — 403 là
 * xác nhận id có thật, biến endpoint thành chỗ dò.
 */
export async function bankAccountDetail(
  actor: User,
  id: string,
): Promise<BankAccountDetail | null> {
  const visible = scopeOf(actor, "view-detail");
  if (visible.kind === "none") return null;

  const r = await rawById(id);
  if (!r || !inScope(visible, r)) return null;
  return detailBody(r);
}

/**
 * Chi tiết MỘT tài khoản cho trang chi tiết ngân hàng — KHÔNG kẹp phạm vi
 * phòng, cùng lý do và cùng chốt `canManageBank` (ở route) với
 * `listBankAccountsOfBank`. Id không thuộc ngân hàng trên URL thì 404.
 */
export async function bankAccountDetailOfBank(
  bankId: string,
  accountId: string,
): Promise<BankAccountDetail | null> {
  const r = await rawById(accountId);
  if (!r || r.bankId !== bankId) return null;
  return detailBody(r);
}

/** Trọn thân chi tiết — P-22 và trang chi tiết ngân hàng dùng chung. */
async function detailBody(r: DecoratedRow): Promise<BankAccountDetail> {
  // CNKD/HKD đọc bản của ĐÚNG loại mình — chưa cài thì không có hướng dẫn,
  // không lấy bản thường thay (chốt 2026-09-02).
  const accountType = accountTypeOf(r);
  const separateGuide = accountType === "CNKD" || accountType === "HKD";
  const variant = await guideVariantFor(r.bankId, accountType);

  return {
    ...toRow(r),
    channelDetail: r.channelDetail,
    accountType,
    note: r.note,
    errorNote: r.errorNote,
    createdByDepartmentId: r.createdByDepartmentId,
    photoUrls: await photoUrlsOf(r.id, "opening"),
    transactionAt: r.transactionAt,
    transactionPhotoUrls: await photoUrlsOf(r.id, "transaction"),
    finishedAt: r.finishedAt?.toISOString() ?? "",
    requiredPhotos: variant?.requiredPhotos ?? r.requiredPhotos,
    accountNumberMethod: r.accountNumberMethod,
    accountNumberPrefix: r.accountNumberPrefix,
    accountNumberLength: r.accountNumberLength,
    customerPhones: await customerPhoneNumbers(r.customerId),
    referralOpenUrl: r.referralOpenUrl,
    referralQrUrl: r.referralQrImage ? imageUrl(r.referralQrImage) : "",
    bankGuide: separateGuide ? (variant?.guide ?? "") : r.bankGuide,
    bankGuidePhotoUrls: await bankGuidePhotoUrls(
      r.bankId,
      separateGuide ? (accountType as "CNKD" | "HKD") : "none",
    ),
  };
}

/**
 * Ảnh mẫu trong hướng dẫn của một ngân hàng, đúng thứ tự người nhập xếp.
 *
 * Thứ tự là phần của dữ liệu: đoạn hướng dẫn gọi tên chúng là "Ảnh 1", "Ảnh 2".
 */
async function bankGuidePhotoUrls(
  bankId: string,
  accountType: "none" | "CNKD" | "HKD" = "none",
): Promise<string[]> {
  const rows = await db
    .select({ url: bankGuidePhotos.url })
    .from(bankGuidePhotos)
    .where(and(eq(bankGuidePhotos.bankId, bankId), eq(bankGuidePhotos.accountType, accountType)))
    .orderBy(asc(bankGuidePhotos.sortOrder));
  return rows.map((r) => imageUrl(r.url));
}

/**
 * Bản hướng dẫn theo loại tài khoản (chốt 2026-09-02) — BA BẢN TÁCH HẲN nhau:
 * CNKD/HKD chưa cài thì KHÔNG có hướng dẫn, không lấy bản thường thay. `null`
 * chỉ xảy ra với dòng cũ chưa lưu lại lần nào; khi đó phần chữ/ảnh coi như
 * trống, riêng SỐ ẢNH bắt buộc lui về số của ngân hàng — 0 ảnh là hoàn thành
 * không cần chứng minh, không được là mặc định. Luật "đủ ảnh mới cho Hoàn
 * thành" cũng đọc `requiredPhotos` từ đây, không chỉ phần hiển thị.
 */
async function guideVariantFor(
  bankId: string,
  accountType: string,
): Promise<{ requiredPhotos: number; guide: string } | null> {
  if (accountType !== "CNKD" && accountType !== "HKD") return null;
  const [row] = await db
    .select({ requiredPhotos: bankGuideVariants.requiredPhotos, guide: bankGuideVariants.guide })
    .from(bankGuideVariants)
    .where(and(eq(bankGuideVariants.bankId, bankId), eq(bankGuideVariants.accountType, accountType)))
    .limit(1);
  return row ? { requiredPhotos: row.requiredPhotos, guide: row.guide ?? "" } : null;
}

export type BankingOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * BƯỚC GIỮ CHỖ — giữ chỗ mã và tạo bản ghi `creating` cho 1–3 ngân hàng trong
 * MỘT giao dịch.
 *
 * ⚠️ ĐÂY LÀ CHỖ DỄ SAI NHẤT CỦA CẢ MODULE (spec §4.5, db-design §10).
 *
 * Mã còn 1 chỗ, hai người cùng bấm. Nếu đọc "còn chỗ" ở một câu rồi ghi ở câu
 * sau thì cả hai đều đọc thấy "còn 1" và cả hai đều ghi được — mã bị bán quá.
 * Khoảng trống giữa lúc ĐỌC và lúc GHI chính là chỗ lọt, và con số hiển thị ở
 * ô chọn có chính xác tới đâu cũng không bịt được.
 *
 * Nên phép kiểm phải nằm TRONG giao dịch, sau `select … for update` khoá dòng
 * mã lại: request thứ hai đứng đợi ở đó, tới lượt nó thì `holding_count` đã
 * tăng và nó thấy đúng con số mới. Ba cột đếm do trigger
 * `mgst_sync_referral_counts` giữ nên chỉ ĐỌC, không tự cộng trừ.
 *
 * Một lượt chạm NHIỀU dòng mã, nên thứ tự khoá thành ra quan trọng — xem chú
 * thích ở vòng lặp bên dưới.
 */
export async function startBankAccount(
  actor: User,
  form: BankAccountStartForm,
): Promise<BankingOutcome<BankAccount[]>> {
  const department = departmentForNewRecord(actor, "banking", form.departmentId);
  if (!department.ok) return { ok: false, message: department.message };

  const [customer] = await db
    .select({
      id: customers.id,
      dob: customers.dob,
      channelId: customers.channelId,
      channelDetail: customers.channelDetail,
    })
    .from(customers)
    .where(eq(customers.id, form.customerId))
    .limit(1);
  if (!customer) return { ok: false, message: "Không tìm thấy khách hàng này" };

  const chosenBanks = await db
    .select({
      id: banks.id,
      code: banks.code,
      active: banks.active,
      minAge: banks.minAge,
      maxAge: banks.maxAge,
    })
    .from(banks)
    .where(inArray(banks.id, form.picks.map((p) => p.bankId)));

  const bankById = new Map(chosenBanks.map((b) => [b.id, b]));
  for (const pick of form.picks) {
    const bank = bankById.get(pick.bankId);
    if (!bank) return { ok: false, message: "Không tìm thấy ngân hàng này" };
    if (!bank.active)
      return { ok: false, message: `Ngân hàng ${bank.code} đã ngừng triển khai` };
    if (!meetsBankAgeRule(customer.dob, bank))
      return {
        ok: false,
        message: customer.dob
          ? `Khách không thuộc độ tuổi mở tài khoản ${bank.code} (${ageRuleLabel(bank)}).`
          : `Ngân hàng ${bank.code} yêu cầu ngày sinh khách hàng để kiểm tra độ tuổi.`,
      };
  }

  const outcome = await db.transaction(async (tx) => {
    /**
     * Khoá dòng KHÁCH trước khi đếm.
     *
     * Hai request mở hai ngân hàng khác nhau cho cùng một khách chạm hai dòng
     * mã khác nhau, nên khoá mã bên dưới không xếp hàng chúng lại: cả hai cùng
     * đếm ra 2 dòng cũ và cùng chèn dòng thứ 3, ra 4 tài khoản. Khoá dòng khách
     * là thứ duy nhất chung cho mọi lượt mở của khách đó.
     *
     * Khoá khách TRƯỚC, khoá mã SAU — giữ đúng thứ tự này ở mọi đường ghi để
     * không có hai giao dịch khoá chéo nhau.
     */
    await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, form.customerId))
      .for("update");

    const owned = await tx
      .select({ bankId: bankAccounts.bankId })
      .from(bankAccounts)
      .where(eq(bankAccounts.customerId, form.customerId));

    // Kiểm trùng ngân hàng TRƯỚC kiểm trần: khách đã có đủ 3 tài khoản mà chọn
    // lại đúng ngân hàng cũ thì câu "đã có TPB rồi" mới là câu chỉ đúng chỗ.
    const ownedIds = new Set(owned.map((r) => r.bankId));
    const trung = form.picks.find((p) => ownedIds.has(p.bankId));
    if (trung)
      return {
        ok: false as const,
        message: `Khách này đã có tài khoản ${bankById.get(trung.bankId)!.code} — mỗi ngân hàng chỉ mở được một tài khoản. Bản nháp cũng tính; xoá bản nháp thì mở lại được.`,
      };

    if (owned.length + form.picks.length > MAX_BANK_ACCOUNTS_PER_CUSTOMER)
      return {
        ok: false as const,
        message: `Khách này đã có ${owned.length} tài khoản ngân hàng, chọn thêm ${form.picks.length} là vượt trần ${MAX_BANK_ACCOUNTS_PER_CUSTOMER}.`,
      };

    const ids: string[] = [];
    /**
     * Khoá các dòng mã theo THỨ TỰ ID TĂNG DẦN, không theo thứ tự người dùng
     * tích. Hai lượt mở cùng chạm hai mã `A` và `B` mà một lượt khoá A→B còn
     * lượt kia khoá B→A thì hai giao dịch chờ nhau và Postgres phải huỷ một bên.
     *
     * Cả lượt nằm trong MỘT giao dịch: một mã hết chỗ thì không dòng nào được
     * ghi. Ghi được hai dòng rồi dừng ở dòng thứ ba là để lại một lượt mở dở
     * mà người dùng không hề chọn.
     */
    for (const pick of [...form.picks].sort((a, b) => a.referralCode.localeCompare(b.referralCode))) {
      const [code] = await tx
        .select({
          id: referralCodes.id,
          code: referralCodes.code,
          bankId: referralCodes.bankId,
          total: referralCodes.total,
          importedUsed: referralCodes.importedUsed,
          usedCount: referralCodes.usedCount,
          holdingCount: referralCodes.holdingCount,
          accountType: referralCodes.accountType,
          scope: referralCodes.scope,
          active: referralCodes.active,
        })
        .from(referralCodes)
        .where(eq(referralCodes.id, pick.referralCode))
        .limit(1)
        // Khoá dòng mã. Request thứ hai chạm cùng dòng này sẽ ĐỨNG ĐỢI ở đây,
        // không đọc được con số cũ.
        .for("update");

      if (!code) return { ok: false as const, message: "Không tìm thấy mã giới thiệu này" };
      if (code.bankId !== pick.bankId)
        return { ok: false as const, message: "Mã giới thiệu này không thuộc ngân hàng đã chọn" };
      if (code.accountType !== pick.accountType)
        return {
          ok: false as const,
          message: `Mã ${code.code} không thuộc loại tài khoản đã chọn. Chọn lại mã giúp.`,
        };
      // Ô chọn đã lọc mã ngừng, nhưng đây mới là chốt — cùng lý do với phạm vi phòng.
      if (!code.active)
        return {
          ok: false as const,
          message: `Mã ${code.code} đã ngừng sử dụng. Chọn mã khác giúp.`,
        };

      /**
       * Kiểm LẠI phạm vi phòng ở đây, không tin ô chọn đã lọc (spec §4.4d).
       *
       * Ô chọn lọc cho gọn màn hình; đường này mới là chốt. Gọi thẳng API với một
       * mã của phòng khác thì phải bị từ chối.
       */
      if (code.scope !== "all") {
        const [allowed] = await tx
          .select({ id: referralCodeDepartments.departmentId })
          .from(referralCodeDepartments)
          .where(
            and(
              eq(referralCodeDepartments.referralCodeId, code.id),
              department.departmentId
                ? eq(referralCodeDepartments.departmentId, department.departmentId)
                : sql`false`,
            ),
          )
          .limit(1);

        if (!allowed)
          return {
            ok: false as const,
            message: `Mã ${code.code} không dùng được cho phòng đã chọn.`,
          };
      }

      const remaining = code.total - code.importedUsed - code.usedCount - code.holdingCount;
      if (remaining <= 0)
        return {
          ok: false as const,
          message: `Mã ${code.code} vừa hết chỗ — người khác đã lấy chỗ cuối. Chọn mã khác giúp.`,
        };

      const [row] = await tx
        .insert(bankAccounts)
        .values({
          customerId: form.customerId,
          bankId: pick.bankId,
          referralCodeId: code.id,
          status: "creating",
          // Kênh CHÉP từ khách lúc mở — kênh thuộc về khách, không nhập lại ở đây,
          // và chép thì đổi kênh của khách về sau không viết lại lịch sử.
          channelId: customer.channelId,
          channelDetail: customer.channelDetail,
          /**
           * Ngày mở ghi NGAY từ bước giữ chỗ, không đợi bước điền nốt.
           *
           * Nhân viên giữ chỗ mã rồi mới đi mở tài khoản thật ở ngoài, có thể tới
           * hôm sau mới quay lại điền nốt. Để cột này trống tới lúc đó thì bản ghi
           * dở dang không có mốc thời gian nào, và nó rơi xuống cuối bảng P-21 vì
           * `nulls last` — đúng chỗ khó tìm nhất với người vừa tạo ra nó.
           *
           * Bước điền nốt vẫn sửa được ngày này. Mở tài khoản thật sang ngày khác
           * thì nhân viên đổi lại cho khớp giấy tờ.
           */
          openedDate: businessDay(),
          createdBy: actor.id,
          // Đơn vị của người tạo lúc tạo. Người này chuyển phòng thì `writeStaff`
          // viết lại cột này cho mọi dòng của họ (chốt 13/08). Người không thuộc
          // phòng nào thì đây là phòng họ chọn ở biểu mẫu.
          createdByDepartmentId: department.departmentId,
          accountType: pick.accountType,
        })
        .returning({ id: bankAccounts.id });

      ids.push(row.id);
    }

    return { ok: true as const, ids };
  });

  if (!outcome.ok) return { ok: false, message: outcome.message };

  const created = await Promise.all(outcome.ids.map((id) => accountById(id)));
  // Trả lại ĐÚNG thứ tự người dùng tích, không phải thứ tự khoá dòng mã.
  const byBank = new Map(created.filter((a) => a !== null).map((a) => [a.bankId, a]));
  return { ok: true, value: form.picks.map((p) => byBank.get(p.bankId)!).filter(Boolean) };
}

/**
 * Chỗ mở tài khoản còn lại của một khách — bước 1 P-20 đọc để lọc ô chọn ngân
 * hàng, thay vì để người dùng chọn xong mã rồi mới bị từ chối.
 *
 * KHÔNG áp phạm vi phòng. Trần áp cho khách, nên phải đếm cả tài khoản do phòng
 * khác mở; lọc theo phạm vi ở đây là báo còn chỗ trong khi máy chủ sẽ từ chối.
 * Đường này chỉ trả về id ngân hàng và một con số, không lộ bản ghi nào.
 */
export async function customerBankSlots(customerId: string): Promise<CustomerBankSlots | null> {
  const [customer] = await db
    .select({ id: customers.id, dob: customers.dob })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) return null;

  const [rows, bankRows] = await Promise.all([
    db
      .select({ bankId: bankAccounts.bankId })
      .from(bankAccounts)
      .where(eq(bankAccounts.customerId, customerId)),
    db.select({ id: banks.id, minAge: banks.minAge, maxAge: banks.maxAge }).from(banks),
  ]);

  return {
    usedBankIds: rows.map((r) => r.bankId),
    eligibleBankIds: bankRows.filter((bank) => meetsBankAgeRule(customer.dob, bank)).map((bank) => bank.id),
    remaining: Math.max(0, MAX_BANK_ACCOUNTS_PER_CUSTOMER - rows.length),
  };
}

/**
 * Cảnh báo mềm mức KHÁCH HÀNG (spec §4.8) — hiện ra rồi vẫn lưu, không chặn.
 *
 * Đếm trên TOÀN BỘ tài khoản `done` của khách, không đếm trong một bản ghi:
 * nhân viên có thể mở tài khoản thứ hai vào một ngày khác, tới lúc đó mới đủ dữ
 * liệu để biết khách đã đạt hay chưa (spec §4.2).
 *
 * CNKD/HKD có `counts_as_app = false`: tính điểm KPI nhưng KHÔNG cộng vào tổng
 * app khi xét quà (spec §4.9) — nên phép đếm này lọc theo `counts_as_app`.
 *
 * TODO(P-20, chờ chốt câu 7.2 và 7.3): spec §4.8 đòi ba luật này nằm CÙNG chỗ
 * với quy tắc quà, vì chúng đổi cùng nhau theo chương trình của ngân hàng.
 * Chuyển sang `src/rules/` được rồi, nhưng ba câu cảnh báo đang đếm theo "tổng
 * app" của luật CŨ — viết lại theo combo thì phải biết `TCB`/`CNKD`/`HKD` có
 * tham gia không (câu 7.2) và mở lẻ một tài khoản có cảnh báo gì không (7.3).
 */
async function warningsFor(customerId: string): Promise<string[]> {
  const rows = await db
    .select({
      bankCode: banks.code,
      appInstalled: bankAccounts.appInstalled,
      countsAsApp: banks.countsAsApp,
      accountType: bankAccounts.accountType,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(and(eq(bankAccounts.customerId, customerId), eq(bankAccounts.status, "done")));

  const totalApps = rows.filter((r) => r.appInstalled && r.countsAsApp).length;
  const warnings: string[] = [];

  if (rows.some((r) => r.bankCode === "MSBa") && totalApps < 3)
    warnings.push(
      `Khách có MSBa mà mới cài ${totalApps} app — cài MSBa bắt buộc đủ 3 app, không đủ sẽ bị phạt.`,
    );

  /**
   * Luật 3: một app nhưng là VPa có mở CNKD/HKD thì HỢP LỆ, không cảnh báo.
   *
   * Phải kiểm cả `appInstalled` trên chính dòng VPa đó: ngoại lệ của spec §4.9
   * nói về trường hợp app DUY NHẤT ấy là VPa. Khách có VPa+CNKD nhưng CHƯA cài
   * app, cộng thêm một VPb đã cài, thì app duy nhất là VPb — không thuộc ngoại
   * lệ, mà bỏ vế này thì hệ thống im lặng.
   */
  const vpaWithExtra = rows.some(
    (r) => r.bankCode === "VPa" && r.accountType !== "none" && r.appInstalled,
  );
  if (totalApps === 1 && !vpaWithExtra)
    warnings.push("Khách mới cài 1 app — nên tư vấn khách cài thêm.");

  return warnings;
}

/**
 * BƯỚC 2 — điền nốt rồi Hoàn thành. Lúc này mã mới thật sự bị tiêu.
 *
 * Chốt ảnh là chốt CỨNG duy nhất của module (spec §4.8 luật 4): thiếu ảnh là
 * thiếu dữ liệu chứ không phải một quyết định kinh doanh. Ba luật còn lại chỉ
 * cảnh báo.
 */
export async function finishBankAccount(
  actor: User,
  id: string,
  form: BankAccountFinishForm,
): Promise<BankingOutcome<{ account: BankAccount; warnings: string[] }> | null> {
  const visible = scopeOf(actor, WRITE_ACTION);
  if (visible.kind === "none") return null;

  const current = await rawById(id);
  if (!current || !inScope(visible, current)) return null;

  if (current.status !== "creating")
    return { ok: false, message: "Tài khoản này đã hoàn thành rồi" };

  // Loại tài khoản đã chốt cùng mã giới thiệu ở bước giữ chỗ. Bước hoàn tất chỉ
  // bổ sung chứng từ, không được đổi loại rồi giữ một mã của nhánh khác.
  const accountType = current.accountType;

  // CNKD/HKD có bản riêng thì số ảnh bắt buộc đọc từ bản đó (chốt 2026-09-02).
  const requiredPhotos =
    (await guideVariantFor(current.bankId, accountTypeOf(current)))?.requiredPhotos ??
    current.requiredPhotos;

  /**
   * Ngân hàng lấy số tài khoản THEO SĐT thì số gửi lên phải là một số của chính
   * khách này. Giao diện dựng ô chọn, nhưng ô chọn không phải chốt chặn —
   * request nặn tay gửi số bất kỳ vẫn tới đây, và tài khoản `done` thì số tài
   * khoản không sửa lại được nữa.
   */
  if (current.accountNumberMethod === "phone-match") {
    const phones = await customerPhoneNumbers(current.customerId);
    if (!phones.includes(form.accountNumber))
      return {
        ok: false,
        message: `Ngân hàng ${current.bankCode} lấy số tài khoản theo SĐT — chọn một số điện thoại của khách.`,
      };
  }

  // Ô nhập đã giới hạn độ dài, nhưng ô nhập không phải chốt chặn — cùng lý do
  // với phép kiểm phone-match ngay trên.
  if (
    current.accountNumberMethod === "manual" &&
    current.accountNumberLength !== null &&
    form.accountNumber.length !== current.accountNumberLength
  )
    return {
      ok: false,
      message: `Số tài khoản ${current.bankCode} phải đủ ${current.accountNumberLength} chữ số.`,
    };

  /**
   * Đếm ảnh và ghi phải nằm TRONG CÙNG MỘT GIAO DỊCH, và câu ghi phải mang lại
   * điều kiện `status = 'creating'`.
   *
   * Bản đầu đọc-kiểm-ghi bằng ba câu rời: hai request `finish` chạy song song
   * đều qua chốt, câu thứ hai ghi đè số tài khoản và ngày mở của một bản ghi đã
   * `done` — đúng thứ thiết kế nói là khoá. Và `setPhotos` xen vào giữa lúc đếm
   * với lúc ghi thì tài khoản lên `done` với ít ảnh hơn mức bắt buộc.
   */
  const outcome = await db.transaction(async (tx) => {
    const [photos] = await tx
      .select({ n: count() })
      .from(bankAccountPhotos)
      .where(and(eq(bankAccountPhotos.accountId, id), eq(bankAccountPhotos.kind, "opening")));

    const have = photos?.n ?? 0;
    if (have < requiredPhotos)
      return {
        ok: false as const,
        message: `Ngân hàng ${current.bankCode} cần ${requiredPhotos} ảnh chứng minh, hiện mới có ${have}.`,
      };

    const updated = await tx
      .update(bankAccounts)
      .set({
        accountNumber: form.accountNumber,
        openedDate: form.openedDate,
        appInstalled: form.appInstalled,
        accountType,
        note: form.note,
        status: "done",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      // Điều kiện trạng thái nằm ngay trong câu ghi — người thứ hai không ghi
      // trúng dòng nào và biết ngay là mình chậm chân.
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.status, "creating")))
      .returning({ id: bankAccounts.id });

    if (updated.length === 0)
      return { ok: false as const, message: "Tài khoản này vừa được hoàn thành ở nơi khác" };
    return { ok: true as const };
  });

  if (!outcome.ok) return { ok: false, message: outcome.message };

  // Điểm chỉ tính tài khoản `done`, nên đây là nhánh BẮT BUỘC gọi tính lại. Ghi
  // cho CHỦ HỒ SƠ KHÁCH và THÁNG CỦA NGÀY MỞ (chốt 07/08, câu 7.11) — không
  // phải người bấm nút, cũng không phải tháng hiện tại.
  await recomputeKpiForCustomer(
    current.customerId,
    businessMonth(new Date(`${form.openedDate}T00:00:00+07:00`)),
  );
  // Tài khoản mới `done` có thể vừa làm khách đủ combo — P-40 và P-80 đọc cột
  // lưu sẵn nên phải ghi lại ngay tại đây, không có trigger nào lo hộ.
  await recomputeGiftCase(current.customerId);

  return {
    ok: true,
    value: {
      account: (await accountById(id))!,
      warnings: await warningsFor(current.customerId),
    },
  };
}

/**
 * SỬA một tài khoản ĐÃ hoàn thành (chốt 07/08).
 *
 * db-design §10 trước đây khoá cứng bản ghi `done`, lý do là "đã tiêu một lượt
 * mã và đã vào điểm KPI". Lý do đó chỉ đúng với MÃ GIỚI THIỆU, KHÁCH và NGÂN
 * HÀNG — ba thứ đó vẫn không sửa được ở đây, vì đổi chúng là viết lại lịch sử
 * kho mã. Còn số tài khoản gõ nhầm, ngày mở ghi lệch, hay quên tích "đã cài
 * app" thì trước đây không có đường chữa nào ngoài xoá — mà bản `done` lại
 * không xoá được. Ngõ cụt thật, gặp thường xuyên.
 *
 * Hai thứ phải tính lại sau khi ghi, và ĐỀU dễ quên:
 *
 * 1. Đổi ngày mở là đổi THÁNG tính điểm, nên tính lại CẢ tháng cũ lẫn tháng
 *    mới — chỉ tính tháng mới thì lượt đó được đếm hai lần.
 * 2. Bỏ tích app của `VPa` hay `MSBa` làm khách rơi khỏi combo, tức đổi cả
 *    trường hợp quà — `recomputeGiftCase` phải chạy theo.
 *
 * Đây cũng là chỗ ghi BƯỚC 3 (spec §4.2) — ngày khách phát sinh giao dịch, nộp
 * muộn sau khi tài khoản đã xong. Trùng ngày mở vẫn nhận (chốt 07/08).
 */
export async function updateFinishedAccount(
  actor: User,
  id: string,
  form: BankAccountUpdateForm,
): Promise<BankingOutcome<{ account: BankAccount; warnings: string[] }> | null> {
  const visible = scopeOf(actor, WRITE_ACTION);
  if (visible.kind === "none") return null;

  const current = await rawById(id);
  if (!current || !inScope(visible, current)) return null;

  if (current.status !== "done")
    return { ok: false, message: "Tài khoản này chưa hoàn thành — dùng bước Hoàn thành" };

  // Cùng chốt chặn với `finishBankAccount`: đường sửa cũng ghi đè số tài khoản.
  if (current.accountNumberMethod === "phone-match") {
    const phones = await customerPhoneNumbers(current.customerId);
    if (!phones.includes(form.accountNumber))
      return {
        ok: false,
        message: `Ngân hàng ${current.bankCode} lấy số tài khoản theo SĐT — chọn một số điện thoại của khách.`,
      };
  }

  if (
    current.accountNumberMethod === "manual" &&
    current.accountNumberLength !== null &&
    form.accountNumber.length !== current.accountNumberLength
  )
    return {
      ok: false,
      message: `Số tài khoản ${current.bankCode} phải đủ ${current.accountNumberLength} chữ số.`,
    };

  // Mã giới thiệu và loại tài khoản là lịch sử đã chốt, không đổi ở màn sửa.
  const accountType = current.accountType;
  const previousDate = current.date;

  // Điều kiện `done` nằm ngay trong câu ghi, không chỉ ở phép kiểm bên trên:
  // giữa lúc đọc và lúc ghi, người khác có thể vừa xoá bản ghi này.
  const updated = await db
    .update(bankAccounts)
    .set({
      accountNumber: form.accountNumber,
      openedDate: form.openedDate,
      // Ô để trống nghĩa là XOÁ ghi nhận, không phải "giữ nguyên" — người dùng
      // xoá ngày đi rồi bấm Lưu thì phải mất thật.
      transactionAt: form.transactionAt || null,
      appInstalled: form.appInstalled,
      accountType,
      note: form.note,
      updatedAt: new Date(),
    })
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.status, "done")))
    .returning({ id: bankAccounts.id });

  if (updated.length === 0)
    return { ok: false, message: "Tài khoản này vừa bị đổi ở nơi khác" };

  const months = new Set(
    [previousDate, form.openedDate]
      .filter((d): d is string => Boolean(d))
      .map((d) => businessMonth(new Date(`${d}T00:00:00+07:00`))),
  );
  for (const month of months) await recomputeKpiForCustomer(current.customerId, month);
  await recomputeGiftCase(current.customerId);

  return {
    ok: true,
    value: {
      account: (await accountById(id))!,
      warnings: await warningsFor(current.customerId),
    },
  };
}

/**
 * Đối soát ngược một tài khoản đã hoàn thành.
 *
 * `error` loại dòng này khỏi mọi phép tính KPI vì các truy vấn KPI chỉ lấy
 * `done`. Không gọi `recomputeGiftCase`: quà đã chốt/đã tư vấn không bị đổi
 * chỉ vì đối soát lại một tài khoản ngân hàng.
 */
export async function updateBankAccountStatus(
  actor: User,
  id: string,
  form: BankAccountStatusUpdateForm,
): Promise<BankingOutcome<BankAccount> | null> {
  const visible = scopeOf(actor, WRITE_ACTION);
  if (visible.kind === "none") return null;

  const current = await rawById(id);
  if (!current || !inScope(visible, current)) return null;
  if (current.status === "creating")
    return { ok: false, message: "Tài khoản đang tạo không thể đối soát lỗi." };
  if (current.status === form.status)
    return { ok: false, message: "Tài khoản đang ở trạng thái này rồi." };

  const updated = await db
    .update(bankAccounts)
    .set({
      status: form.status,
      errorNote: form.status === "error" ? form.errorNote : "",
      updatedAt: new Date(),
    })
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.status, current.status)))
    .returning({ id: bankAccounts.id });
  if (updated.length === 0)
    return { ok: false, message: "Tài khoản vừa được đối soát ở nơi khác." };

  // Tài khoản lỗi bị loại ra, tài khoản khôi phục lại được tính vào. Chỉ tính
  // tháng mở tài khoản, không phải tháng bấm đối soát.
  if (current.date)
    await recomputeKpiForCustomer(
      current.customerId,
      businessMonth(new Date(`${current.date}T00:00:00+07:00`)),
    );

  return { ok: true, value: (await accountById(id))! };
}

/**
 * Bỏ dở — chỉ xoá được khi còn `creating` (db-design §10).
 *
 * Xoá dòng đó là NHẢ CHỖ mã về kho: trigger `mgst_sync_referral_counts` hạ
 * `holding_count` theo. Ảnh đi kèm chết theo nhờ `on delete cascade`.
 */
export async function deleteDraft(actor: User, id: string): Promise<BankAccount | null> {
  const visible = scopeOf(actor, "delete");
  if (visible.kind === "none") return null;

  const current = await accountById(id);
  if (!current || !inScope(visible, current)) return null;
  // Tài khoản đã hoàn thành thì không xoá — nó đã tiêu một lượt mã và đã vào
  // điểm KPI. Trả `null` để route ra 404 y như "không có".
  if (current.status !== "creating") return null;

  // Điều kiện `creating` nằm ngay trong câu xoá, không chỉ ở phép kiểm bên trên:
  // giữa lúc đọc và lúc xoá, người khác có thể vừa bấm Hoàn thành xong — xoá
  // trúng thì mất một bản ghi `done` thật, mã đã tiêu bị nhả lại, còn điểm KPI
  // thì giữ nguyên cho tới lần tính lại sau.
  const removed = await db
    .delete(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.status, "creating")))
    .returning({ id: bankAccounts.id });
  if (removed.length === 0) return null;

  return current;
}

/**
 * Ghi danh sách ảnh của MỘT nhóm. Ảnh xem/thêm/thay được BẤT KỂ trạng thái —
 * tài khoản đã hoàn thành vẫn phải bổ sung được ảnh còn thiếu.
 *
 * Nhận URL chứ không nhận file: đẩy ảnh lên kho là việc của `/api/uploads`.
 * Xoá sạch rồi ghi lại theo đúng thứ tự mảng gửi lên — mảng ĐÃ là trạng thái
 * mong muốn, không phải một lệnh thêm.
 *
 * `kind` khoanh vùng cả lượt xoá lẫn lượt chèn. Không khoanh thì nộp ảnh giao
 * dịch sẽ xoá sạch ảnh chứng minh của bước 2, và bản ghi `done` nằm lại với 0
 * ảnh bắt buộc mà không đường nào phát hiện.
 */
export async function setPhotos(
  actor: User,
  id: string,
  /** KHOÁ trong kho, không phải URL — route đã cắt phần `/api/images/` ra. */
  photoKeys: string[],
  kind: PhotoKind,
): Promise<BankAccount | { tooFew: number } | { locked: true } | null> {
  const visible = scopeOf(actor, WRITE_ACTION);
  if (visible.kind === "none") return null;

  const current = await rawById(id);
  if (!current || !inScope(visible, current)) return null;

  /**
   * Hết ngày hoàn thành là ảnh chứng minh chốt lại (chốt 2026-08-23) — luật ở
   * `canEditOpeningPhotos`, giao diện khoá theo cùng hàm đó.
   *
   * Đứng TRƯỚC phép đếm bên dưới: bản ghi đã khoá thì thừa hay thiếu ảnh cũng
   * không đổi câu trả lời, mà báo "thiếu ảnh" cho một lượt vốn không được phép
   * là chỉ sai đường sửa.
   */
  if (kind === "opening" && !canEditOpeningPhotos(actor, photoWindowOf(current)))
    return { locked: true } as const;

  /**
   * Tài khoản ĐÃ HOÀN THÀNH không được tụt xuống dưới mức ảnh bắt buộc.
   *
   * Chốt ảnh cứng ở `finishBankAccount` chỉ canh đúng lúc bấm Hoàn thành. Không
   * có chốt ở đây thì đi vòng qua nhịp sau là xong: hoàn thành với đủ 3 ảnh —
   * mã tiêu, KPI cộng — rồi gọi endpoint này với mảng rỗng, bản ghi ở lại `done`
   * với 0 ảnh chứng minh và không đường nào phát hiện.
   *
   * Bản `creating` thì cho tự do: nó chưa tiêu gì, và người dùng đang trong lúc
   * thêm dần từng tấm.
   *
   * Ảnh giao dịch KHÔNG bị chốt này: nó là bằng chứng nộp muộn, để trống hay bỏ
   * đi đều hợp lệ, và `banks.required_photos` không nói gì về nó.
   */
  const requiredPhotos =
    (await guideVariantFor(current.bankId, accountTypeOf(current)))?.requiredPhotos ??
    current.requiredPhotos;
  if (kind === "opening" && current.status === "done" && photoKeys.length < requiredPhotos)
    return { tooFew: requiredPhotos } as const;

  await db.transaction(async (tx) => {
    await tx
      .delete(bankAccountPhotos)
      .where(and(eq(bankAccountPhotos.accountId, id), eq(bankAccountPhotos.kind, kind)));
    if (photoKeys.length > 0)
      await tx.insert(bankAccountPhotos).values(
        photoKeys.map((url, i) => ({ accountId: id, kind, url, sortOrder: i })),
      );
  });

  return accountById(id);
}
