import { and, asc, count, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type {
  BankAccount,
  BankAccountFinishForm,
  BankAccountStartForm,
} from "@/lib/api/bankAccounts";
import type { BankAccountDetail, BankAccountRow, BankAccountSort } from "@/lib/api/banking";
import type { Page } from "@/lib/api/pagination";
import { businessMonth } from "@/lib/format";
import { recordVisibility, type RecordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { db } from "./db/client";
import {
  bankAccountPhotos,
  bankAccounts,
  banks,
  channels,
  customerPhones,
  customers,
  departments,
  referralCodes,
  users,
} from "./db/schema";
import { recomputeKpiForCustomer } from "./kpi";
import type { PageArgs } from "./pagination";

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

const YEAR_MONTH_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
    YEAR_MONTH_DAY.test(query.from) ? gte(bankAccounts.openedDate, query.from) : undefined,
    YEAR_MONTH_DAY.test(query.to) ? lte(bankAccounts.openedDate, query.to) : undefined,
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
      channelId: bankAccounts.channelId,
      channelDetail: bankAccounts.channelDetail,
      appInstalled: bankAccounts.appInstalled,
      accountType: bankAccounts.accountType,
      note: bankAccounts.note,
      createdBy: bankAccounts.createdBy,
      createdByDepartmentId: bankAccounts.createdByDepartmentId,
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
      // Cột nullable ở DB nhưng hợp đồng là chuỗi: `''` lúc còn `creating` —
      // chưa mở xong thì chưa biết số thật.
      accountNumber: sql<string>`coalesce(${page.accountNumber}, '')`,
      date: sql<string>`coalesce(${page.openedDate}::text, '')`,
      channel: sql<string>`coalesce(${channels.name}, '')`,
      channelDetail: page.channelDetail,
      appInstalled: page.appInstalled,
      accountType: page.accountType,
      note: page.note,
      createdById: page.createdBy,
      createdByName: users.fullName,
      createdByDepartmentId: page.createdByDepartmentId,
      createdByDepartmentName: departments.name,
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
 * Sắp theo ngày mở, NULL xuống cuối.
 *
 * Viết thẳng `desc nulls last` chứ không bọc `desc(sql\`… nulls last\`)`: bọc
 * thì drizzle nối thành `opened_date nulls last desc`, mà Postgres đòi đúng thứ
 * tự `desc nulls last` — sai là lỗi cú pháp, không phải sắp nhầm.
 *
 * `nulls last` là cố ý: tài khoản còn `creating` chưa có ngày mở, mà mặc định
 * Postgres xếp NULL lên ĐẦU khi giảm dần — bảng mở ra toàn bản nháp trong khi
 * người dùng đang tìm tài khoản mới hoàn thành.
 */
const byOpenedDate = (dir: "asc" | "desc"): SQL =>
  dir === "asc"
    ? sql`${bankAccounts.openedDate} asc nulls last`
    : sql`${bankAccounts.openedDate} desc nulls last`;

/** MỘT trang tài khoản, đã lọc/tìm/sắp sẵn ở máy chủ (AGENTS.md §5.1). */
export async function listBankAccounts(
  actor: User,
  filters: BankAccountFilters,
  page: PageArgs<BankAccountSort>,
): Promise<Page<BankAccountRow>> {
  const visible = scopeOf(actor, "view-detail");
  if (visible.kind === "none") return { rows: [], total: 0 };

  const where = await accountFilters(visible, filters);
  const orderBy = [byOpenedDate(page.dir), asc(bankAccounts.id)] as SQL[];

  const [rows, [totals]] = await Promise.all([
    decorate(pickPage(where, orderBy, page.limit, page.offset)),
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
  const orderBy = [byOpenedDate("desc"), asc(bankAccounts.id)] as SQL[];

  const [rows, [totals]] = await Promise.all([
    decorate(pickPage(where, orderBy, EXPORT_LIMIT, 0)),
    db.select({ value: count() }).from(bankAccounts).where(where),
  ]);

  return { rows: rows.map(toRow), total: totals?.value ?? 0 };
}

const photoUrlsOf = async (accountId: string): Promise<string[]> =>
  (
    await db
      .select({ url: bankAccountPhotos.url })
      .from(bankAccountPhotos)
      .where(and(eq(bankAccountPhotos.accountId, accountId), eq(bankAccountPhotos.kind, "opening")))
      .orderBy(asc(bankAccountPhotos.sortOrder), asc(bankAccountPhotos.id))
  ).map((r) => r.url);

const rawById = async (id: string): Promise<DecoratedRow | null> =>
  (await decorate(pickPage(eq(bankAccounts.id, id), [], 1, 0)))[0] ?? null;

/** Dạng đầy đủ mà các endpoint GHI trả về (hợp đồng `BankAccount`). */
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
    photoUrls: await photoUrlsOf(id),
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

  const [phone] = await db
    .select({ number: customerPhones.number })
    .from(customerPhones)
    .where(and(eq(customerPhones.customerId, r.customerId), eq(customerPhones.isPrimary, true)))
    .limit(1);

  return {
    ...toRow(r),
    channelDetail: r.channelDetail,
    accountType: r.accountType,
    note: r.note,
    createdByDepartmentId: r.createdByDepartmentId,
    photoUrls: await photoUrlsOf(id),
    requiredPhotos: r.requiredPhotos,
    accountNumberMethod: r.accountNumberMethod,
    customerPrimaryPhone: phone?.number ?? "",
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
    const [code] = await tx
      .select({
        id: referralCodes.id,
        code: referralCodes.code,
        bankId: referralCodes.bankId,
        total: referralCodes.total,
        importedUsed: referralCodes.importedUsed,
        usedCount: referralCodes.usedCount,
        holdingCount: referralCodes.holdingCount,
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
        createdBy: actor.id,
        // Snapshot phòng LÚC TẠO (#8) — không bao giờ update lại khi người này
        // luân chuyển, nếu không báo cáo tháng trước tự đổi theo.
        createdByDepartmentId: actor.departmentId,
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
 * TODO(P-20, chờ `src/rules/YYYY-MM.ts`): spec §4.8 đòi ba luật này nằm CÙNG
 * bảng quy tắc sửa được với quy tắc quà, vì chúng đổi cùng nhau theo chương
 * trình của ngân hàng. File luật của kỳ chưa có nên tạm để ở đây; chuyển sang
 * đó khi 12 câu hỏi trong `mgst-the-le/2026-08.md` §7 có trả lời.
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
 * Ghi danh sách ảnh chứng minh. Ảnh xem/thêm/thay được BẤT KỂ trạng thái —
 * tài khoản đã hoàn thành vẫn phải bổ sung được ảnh còn thiếu.
 *
 * Nhận URL chứ không nhận file: đẩy ảnh lên kho là việc của `/api/uploads`.
 * Xoá sạch rồi ghi lại theo đúng thứ tự mảng gửi lên — mảng ĐÃ là trạng thái
 * mong muốn, không phải một lệnh thêm.
 */
export async function setPhotos(
  actor: User,
  id: string,
  photoUrls: string[],
): Promise<BankAccount | { tooFew: number } | null> {
  const visible = scopeOf(actor, WRITE_ACTION);
  if (visible.kind === "none") return null;

  const current = await rawById(id);
  if (!current || !inScope(visible, current)) return null;

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
   */
  if (current.status === "done" && photoUrls.length < current.requiredPhotos)
    return { tooFew: current.requiredPhotos } as const;

  await db.transaction(async (tx) => {
    await tx
      .delete(bankAccountPhotos)
      .where(and(eq(bankAccountPhotos.accountId, id), eq(bankAccountPhotos.kind, "opening")));
    if (photoUrls.length > 0)
      await tx.insert(bankAccountPhotos).values(
        photoUrls.map((url, i) => ({ accountId: id, kind: "opening" as const, url, sortOrder: i })),
      );
  });

  return accountById(id);
}
