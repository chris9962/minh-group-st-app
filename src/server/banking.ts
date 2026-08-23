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
import { canEditOpeningPhotos } from "@/lib/api/bankAccounts";
import type {
  BankAccount,
  BankAccountFinishForm,
  BankAccountStartForm,
  BankAccountUpdateForm,
  PhotoKind,
} from "@/lib/api/bankAccounts";
import type { BankAccountDetail, BankAccountRow, BankAccountSort } from "@/lib/api/banking";
import type { Page } from "@/lib/api/pagination";
import { businessDay, businessMonth } from "@/lib/format";
import { recordVisibility, type RecordVisibility } from "@/lib/permissions";
import { isRealIsoDate, type User } from "@/lib/types";
import { db } from "./db/client";
import { departmentForNewRecord } from "./writeDepartment";
import {
  bankAccountPhotos,
  bankAccounts,
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
  raw === "creating" || raw === "done" ? eq(bankAccounts.status, raw) : undefined;

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
      referralCode: referralCodes.code,
      // Link mở tài khoản của mã này (spec §4.4b). `''` = mã không có link,
      // và bước 2 khi đó không dựng nút "Mở app ngân hàng".
      referralOpenUrl: sql<string>`coalesce(${referralCodes.openUrl}, '')`,
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
      createdById: page.createdBy,
      createdByName: users.fullName,
      createdByDepartmentId: page.createdByDepartmentId,
      createdByDepartmentName: departments.name,
      finishedAt: page.finishedAt,
      status: page.status,
      requiredPhotos: banks.requiredPhotos,
      accountNumberMethod: banks.accountNumberMethod,
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
 * Trần một lượt xuất Excel. Chạm trần thì `total` nói ra sự thật và nơi gọi
 * BẮT BUỘC so hai số — file thiếu 5.000 dòng trông y hệt file đủ.
 */
const EXPORT_LIMIT = 20_000;

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
    accountNumber: r.accountNumber,
    openedDate: r.date,
    channel: r.channel,
    channelDetail: r.channelDetail,
    appInstalled: r.appInstalled,
    accountType: r.accountType,
    note: r.note,
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

  return {
    ...toRow(r),
    channelDetail: r.channelDetail,
    accountType: r.accountType,
    note: r.note,
    createdByDepartmentId: r.createdByDepartmentId,
    photoUrls: await photoUrlsOf(id, "opening"),
    transactionAt: r.transactionAt,
    transactionPhotoUrls: await photoUrlsOf(id, "transaction"),
    finishedAt: r.finishedAt?.toISOString() ?? "",
    requiredPhotos: r.requiredPhotos,
    accountNumberMethod: r.accountNumberMethod,
    customerPhones: await customerPhoneNumbers(r.customerId),
    referralOpenUrl: r.referralOpenUrl,
  };
}

export type BankingOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * BƯỚC 1 — giữ chỗ mã và tạo bản ghi `creating`.
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
 */
export async function startBankAccount(
  actor: User,
  form: BankAccountStartForm,
): Promise<BankingOutcome<BankAccount>> {
  const department = departmentForNewRecord(actor, "banking", form.departmentId);
  if (!department.ok) return { ok: false, message: department.message };

  const [customer] = await db
    .select({
      id: customers.id,
      channelId: customers.channelId,
      channelDetail: customers.channelDetail,
    })
    .from(customers)
    .where(eq(customers.id, form.customerId))
    .limit(1);
  if (!customer) return { ok: false, message: "Không tìm thấy khách hàng này" };

  const [bank] = await db
    .select({ id: banks.id, active: banks.active })
    .from(banks)
    .where(eq(banks.id, form.bankId))
    .limit(1);
  if (!bank) return { ok: false, message: "Không tìm thấy ngân hàng này" };
  if (!bank.active) return { ok: false, message: "Ngân hàng này đã ngừng triển khai" };

  const outcome = await db.transaction(async (tx) => {
    /**
     * MỘT nhân viên chỉ giữ MỘT bản ghi `Đang tạo` tại một thời điểm
     * (spec §4.5b, chốt 2026-08-20).
     *
     * Bản ghi `Đang tạo` chính là cái giữ chỗ mã, và không có hẹn giờ tự nhả —
     * mã chỉ trả lại kho khi ai đó hoàn thành hoặc xoá bằng tay. Không chặn thì
     * một người mở dở mười tài khoản là giữ mười chỗ mà chưa dùng chỗ nào, còn
     * người mở sau nhận báo "hết chỗ".
     *
     * ⚠️ `SELECT … FOR UPDATE` KHÔNG đủ ở đây, khác với chỗ khoá dòng mã bên
     * dưới. Nó chỉ khoá dòng ĐANG CÓ; khi người này chưa mở dở tài khoản nào
     * thì câu chọn trả rỗng và không khoá gì, nên hai request song song đều đọc
     * "chưa có" rồi cùng ghi. Đó đúng là ca luật này sinh ra để chặn.
     *
     * Khoá theo NGƯỜI: `pg_advisory_xact_lock` giữ một khoá mang tên chính
     * `actor.id`, tự nhả khi giao dịch kết thúc. Request thứ hai của cùng người
     * đứng đợi ở dòng này, tới lượt nó thì bản ghi kia đã ghi xong và câu chọn
     * bên dưới thấy được. Hai người khác nhau mang hai khoá khác nhau nên không
     * chờ nhau.
     *
     * Ràng buộc theo NGƯỜI TẠO, không theo khách — một khách vẫn có nhiều bản
     * ghi `Đang tạo` nếu chúng do những nhân viên khác nhau mở (spec §4.2).
     */
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.id}))`);

    const [draft] = await tx
      .select({ customerName: customers.fullName, bankCode: banks.code })
      .from(bankAccounts)
      .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
      .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
      .where(and(eq(bankAccounts.createdBy, actor.id), eq(bankAccounts.status, "creating")))
      .limit(1);

    if (draft)
      return {
        ok: false as const,
        // Câu này phải CHỈ ĐƯỜNG, không chỉ từ chối: nói rõ tài khoản nào đang
        // mở dở thì người dùng biết phải hoàn thành hoặc xoá cái nào.
        message: `Bạn đang mở dở tài khoản ${draft.bankCode} của ${draft.customerName}. Hoàn thành hoặc xoá nó rồi mới mở tài khoản mới.`,
      };

    const [code] = await tx
      .select({
        id: referralCodes.id,
        code: referralCodes.code,
        bankId: referralCodes.bankId,
        total: referralCodes.total,
        importedUsed: referralCodes.importedUsed,
        usedCount: referralCodes.usedCount,
        holdingCount: referralCodes.holdingCount,
        scope: referralCodes.scope,
      })
      .from(referralCodes)
      .where(eq(referralCodes.id, form.referralCode))
      .limit(1)
      // Khoá dòng mã. Request thứ hai chạm cùng dòng này sẽ ĐỨNG ĐỢI ở đây,
      // không đọc được con số cũ.
      .for("update");

    if (!code) return { ok: false as const, message: "Không tìm thấy mã giới thiệu này" };
    if (code.bankId !== form.bankId)
      return { ok: false as const, message: "Mã giới thiệu này không thuộc ngân hàng đã chọn" };

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
        bankId: form.bankId,
        referralCodeId: code.id,
        status: "creating",
        // Kênh CHÉP từ khách lúc mở — kênh thuộc về khách, không nhập lại ở đây,
        // và chép thì đổi kênh của khách về sau không viết lại lịch sử.
        channelId: customer.channelId,
        channelDetail: customer.channelDetail,
        /**
         * Ngày mở ghi NGAY từ bước 1, không đợi bước 2.
         *
         * Nhân viên giữ chỗ mã rồi mới đi mở tài khoản thật ở ngoài, có thể tới
         * hôm sau mới quay lại điền nốt. Để cột này trống tới lúc đó thì bản ghi
         * dở dang không có mốc thời gian nào, và nó rơi xuống cuối bảng P-21 vì
         * `nulls last` — đúng chỗ khó tìm nhất với người vừa tạo ra nó.
         *
         * Bước 2 vẫn sửa được ngày này. Mở tài khoản thật sang ngày khác thì
         * nhân viên đổi lại cho khớp giấy tờ.
         */
        openedDate: businessDay(),
        createdBy: actor.id,
        // Đơn vị của người tạo lúc tạo. Người này chuyển phòng thì `writeStaff`
        // viết lại cột này cho mọi dòng của họ (chốt 13/08). Người không thuộc
        // phòng nào thì đây là phòng họ chọn ở biểu mẫu.
        createdByDepartmentId: department.departmentId,
      })
      .returning({ id: bankAccounts.id });

    return { ok: true as const, id: row.id };
  });

  if (!outcome.ok) return { ok: false, message: outcome.message };
  return { ok: true, value: (await accountById(outcome.id))! };
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

  // CNKD/HKD chỉ có nghĩa với VPa (spec §4.9). Máy chủ nắn lại thay vì tin
  // giao diện: ô chọn đó chỉ hiện khi chọn VPa, nhưng request nặn tay thì không.
  const accountType = current.bankCode === "VPa" ? form.accountType : "none";

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
    if (have < current.requiredPhotos)
      return {
        ok: false as const,
        message: `Ngân hàng ${current.bankCode} cần ${current.requiredPhotos} ảnh chứng minh, hiện mới có ${have}.`,
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

  const accountType = current.bankCode === "VPa" ? form.accountType : "none";
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
  if (kind === "opening" && current.status === "done" && photoKeys.length < current.requiredPhotos)
    return { tooFew: current.requiredPhotos } as const;

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
