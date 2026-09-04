import { and, count, eq, exists, gte, inArray, lt, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bankingPointsFor, bankTierFor, comboPointsAt, giftFor } from "@/rules";
import type { ScoringAccount } from "@/rules";
import { BUSINESS_TIMEZONE } from "@/lib/format";
import { recordVisibility, type RecordVisibility } from "@/lib/permissions";
import { isRealIsoDate, type User } from "@/lib/types";
import { accountExportWhere } from "./banking";
import { searchTerms } from "@/lib/search";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  channels,
  customerPhones,
  customers,
  departments,
  giftGrantChanges,
  giftGrants,
  giftItems,
  insuranceOrders,
  users,
} from "./db/schema";
import type { BankAccountFilters } from "./banking";
import type { ScoringExportRow } from "@/lib/api/exports";

/**
 * Báo cáo #1 · Tính điểm tổng — dựng lại đúng hình dạng sheet `TỔNG` của
 * `TÍNH ĐIỂM TỔNG T8.xlsx`, file Kế toán đang dùng thật.
 *
 * MỘT KHÁCH MỘT DÒNG. Dữ liệu lưu một tài khoản một bản ghi, nên hàm này xoay
 * ngang: mọi tài khoản của cùng một khách gom vào một dòng, mỗi ngân hàng một ô.
 *
 * ⚠️ Đây là báo cáo DUY NHẤT tính lại điểm và quà lúc xuất. Hai con số đó không
 * đọc từ `kpi_scores` hay `customers.gift_basket`: bảng điểm lưu theo NGƯỜI cho
 * cả tháng, còn báo cáo này cần điểm của TỪNG KHÁCH; và bộ lọc ngày có thể cắt
 * hẹp hơn một tháng. Đọc cột lưu sẵn là ra số của phạm vi khác.
 *
 * Luật lấy theo NGÀY MỞ TÀI KHOẢN SỚM NHẤT của khách, cùng mốc với cột `NGÀY`.
 */

/**
 * Trần một lượt xuất, đếm bằng KHÁCH.
 *
 * Một tháng thật của công ty là 37.744 khách (đo trên `TÍNH ĐIỂM TỔNG T8.xlsx`),
 * nên trần phải dư cho cả tháng cộng phần lớn dần. Chạm trần thì `total` nói ra
 * sự thật và nơi gọi BẮT BUỘC so hai số — file thiếu dòng trông y hệt file đủ.
 */
const SCORING_EXPORT_LIMIT = 60_000;

/**
 * Khách nào vào file (chốt 2026-09-03).
 *
 * `with-accounts` — chỉ khách có tài khoản `done` khớp bộ lọc. Đây là hình dạng
 * cũ và vẫn là mặc định: file này đối chiếu điểm, mà khách chưa mở tài khoản thì
 * không có điểm nào để đối.
 *
 * `all` — thêm khách đã lập hồ sơ nhưng CHƯA có tài khoản `done` nào. Đội cần nó
 * để soát ngược: hồ sơ lập trong ngày nhiều hơn hẳn số dòng trong file, và chênh
 * lệch đó không tra được từ chính file.
 */
export type ScoringInclude = "with-accounts" | "all";

/**
 * Khách CHƯA có tài khoản `done` — nhóm chỉ chế độ `all` lấy thêm.
 *
 * Tuỳ chọn "có tài khoản hay không" là MỘT vế AND cạnh các ô lọc khác, không
 * phải một chế độ làm các ô kia mất tác dụng. Hệ quả trực tiếp: lọc theo ngân
 * hàng hoặc mã giới thiệu thì nhóm này rỗng, vì khách chưa có tài khoản nào
 * không thể khớp một mã ngân hàng. Trả `null` để bỏ hẳn nhánh, đúng phép AND.
 *
 * Ba ô còn lại vẫn áp, chỉ đổi cột đọc: ngày đọc `customers.created_at` thay cho
 * `bank_accounts.opened_date`, kênh và người tạo đọc cột của chính bảng khách.
 * Không đổi cột thì mọi điều kiện đều trượt và khách nào cũng vào file.
 */
function customerOnlyWhere(
  actor: User,
  filters: BankAccountFilters,
  scope?: RecordVisibility,
): SQL | undefined | null {
  const visible = scope ?? recordVisibility(actor, "banking", "export");
  if (visible.kind === "none") return null;
  if (filters.bankCode || filters.referralCode) return null;

  const parts = [
    // Ô tìm soi TÊN KHÁCH ở cả hai nhánh, chỉ khác chỗ neo: nhánh tài khoản đi
    // qua `exists`, nhánh này đọc thẳng cột của bảng khách.
    ...searchTerms(filters.search).map(
      (term) =>
        sql`${customers.searchName} like '%' || mgst_normalize(${term.replace(/[\\%_]/g, "\\$&")}) || '%' escape '\\'`,
    ),
    visible.kind === "departments"
      ? inArray(customers.createdByDepartmentId, visible.departmentIds)
      : visible.kind === "creator"
        ? eq(customers.createdBy, visible.userId)
        : undefined,
    // `created_at` là timestamp, `from`/`to` là ngày làm việc Việt Nam — quy về
    // cùng múi giờ trước khi so, cùng cách làm với `server/people.ts`.
    isRealIsoDate(filters.from)
      ? gte(
          customers.createdAt,
          sql`((${filters.from}::date)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
        )
      : undefined,
    // `<` chứ không phải `<=`, khớp `server/people.ts`: mốc 00:00 của ngày kế
    // tiếp thuộc về ngày sau, không đếm vào cả hai ngày.
    isRealIsoDate(filters.to)
      ? lt(
          customers.createdAt,
          sql`((${filters.to}::date + 1)::timestamp at time zone ${BUSINESS_TIMEZONE})`,
        )
      : undefined,
    filters.channelId ? eq(customers.channelId, filters.channelId) : undefined,
    filters.staffId ? eq(customers.createdBy, filters.staffId) : undefined,
  ].filter(Boolean) as SQL[];

  return parts.length > 0 ? and(...parts) : undefined;
}

/** Mã ngân hàng ngoài thể lệ nhưng vẫn ghi nhận — không vào tổ hợp, không ra điểm. */
const HOUSEHOLD_CODES = new Set(["CNKD", "HKD"]);

type AccountRow = {
  customerId: string;
  bankCode: string;
  accountNumber: string | null;
  openedDate: string | null;
  appInstalled: boolean;
  accountType: "none" | "CNKD" | "HKD";
  createdBy: string | null;
};

/**
 * Ấp của khách, dạng file Kế toán đang ghi: `ẤP/XÃ`.
 *
 * `customers.channel_detail` lưu chuỗi TÊN `"Tỉnh · Xã · Ấp"` (quyết định
 * 2026-08-14), nên phải tách rồi ghép ngược. Chuỗi không đủ ba phần thì trả
 * nguyên văn — kênh Bệnh viện và kênh Tự do ghi kiểu khác.
 */
function hamletOf(channelDetail: string): string {
  const parts = channelDetail.split(" · ").map((p) => p.trim());
  if (parts.length < 3) return channelDetail;
  const [, ward, hamlet] = parts;
  return `${hamlet}/${ward}`;
}

/**
 * Nhãn ngắn của loại bảo hiểm, đúng chữ file Kế toán dùng.
 *
 * Đơn xe máy là `BHX`; đơn tai nạn điện tách theo mức phí ghi trong TÊN GÓI.
 * Đọc tên gói chứ không đọc `fee`: người nhập sửa được `fee` từng đơn, còn nhãn
 * thì phải theo gói đã chọn.
 */
function insuranceLabelOf(product: string, packageName: string): string {
  if (product === "motorbike") return "BHX";
  if (packageName.includes("200")) return "BHĐ 200K";
  return "BHĐ 100K";
}

/**
 * Chuỗi bậc quà, đúng chữ cột `QUÀ TẶNG BÁO CÁO` của file Kế toán.
 *
 * ⚠️ Cột đó trong file là chữ GÕ TAY, không có công thức — 37.425 dòng gõ tay,
 * 320 dòng bỏ trống. Sáu chuỗi TH1–TH6 chép từ giá trị xuất hiện nhiều nhất
 * trong file. Kế toán đổi cách ghi thì sửa ở đây.
 *
 * `TH7` và `TH8` là bậc Combo 1, mới từ kỳ 2026-09. File tháng 8 chưa có bậc
 * này nên hai chuỗi đó do đội tự đặt theo cùng khuôn — Kế toán gửi file tháng 9
 * thì đối chiếu lại.
 */
const GIFT_REPORT_LABEL: Record<string, string> = {
  TH1: "1 NĂM BH + 20K (Khi cài đặt được VPa) - COMBO 2,3",
  TH2: "1 NĂM BH - COMBO 2",
  TH3: "1 NĂM BH + 70K (Khi cài đặt được VPa và MSBa) - COMBO 3",
  TH4: "1 NĂM BH + 50K (Khi cài đặt được MSBa) - COMBO 3",
  TH5: "2 NĂM BH + 20K (Khi cài đặt được VPa và MSBb) - COMBO 3",
  TH6: "2 NĂM BH (Không thuộc các trường hợp trên hoặc thiết bị không phù hợp)",
  TH7: "1 NĂM BH - COMBO 1",
  TH8: "1 NĂM BH + 20K (Khi cài đặt được VPa) - COMBO 1",
};

/** Nhãn ngắn của cột `QUÀ TẶNG THEO COMBO`, cùng chữ với công thức `AG` của file. */
const GIFT_COMBO_LABEL: Record<string, string> = {
  TH1: "1 năm BH + 20k",
  TH2: "1 năm BH",
  TH3: "1 năm BH + 70k",
  TH4: "1 năm BH + 50k",
  TH5: "2 năm BH + 20k",
  TH6: "2 năm BH",
  TH7: "1 năm BH",
  TH8: "1 năm BH + 20k",
};

/**
 * Bỏ CCCD và số điện thoại khỏi mỗi dòng (chốt 2026-09-04).
 *
 * Hai trường đó CHỈ tồn tại trong file Excel. Bảng hiện trên màn gọi cùng đường
 * dữ liệu này nhưng bật cờ, nên hai trường không rời máy chủ — xoá cột ở giao
 * diện là chưa đủ, dữ liệu vẫn nằm trong lượt gọi mạng cho ai mở ra cũng đọc.
 */
export async function listScoringExport(
  actor: User,
  filters: BankAccountFilters,
  include: ScoringInclude = "with-accounts",
  omitPii = false,
  scope?: RecordVisibility,
): Promise<{ rows: ScoringExportRow[]; total: number }> {
  const where = await accountExportWhere(actor, filters, scope);
  if (where === null) return { rows: [], total: 0 };

  const done = and(where, eq(bankAccounts.status, "done"));

  /**
   * Cắt trần theo KHÁCH, không theo tài khoản.
   *
   * `EXPORT_LIMIT` của `server/banking.ts` đếm tài khoản, đúng cho báo cáo một
   * tài khoản một dòng. Ở đây đơn vị là khách, mà một tháng thật có 37.744
   * khách trên 102.752 tài khoản — cắt 20.000 tài khoản là ra hơn bảy nghìn
   * khách rồi `capCheck` từ chối xuất, không tháng nào lấy nổi trọn dữ liệu.
   *
   * Cắt ở đây bằng câu con nên tài khoản của khách nào đã chọn thì lấy TRỌN;
   * cắt sau khi nối là khách cuối danh sách bị mất bớt tài khoản, và dòng đó ra
   * điểm thấp hơn thực tế mà không ai thấy.
   */
  const picked = db
    .selectDistinct({ id: bankAccounts.customerId })
    .from(bankAccounts)
    .where(done)
    .limit(SCORING_EXPORT_LIMIT);

  /**
   * Chỉ tài khoản `done`. Bản `creating` là lượt giữ mã, chưa phải tài khoản
   * thật — đưa vào thì khách chưa mở xong đã có điểm.
   */
  const accountRows = await db
    .select({
      customerId: bankAccounts.customerId,
      bankCode: banks.code,
      accountNumber: bankAccounts.accountNumber,
      openedDate: bankAccounts.openedDate,
      appInstalled: bankAccounts.appInstalled,
      accountType: bankAccounts.accountType,
      createdBy: bankAccounts.createdBy,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(and(done, inArray(bankAccounts.customerId, picked)));

  const byCustomer = new Map<string, AccountRow[]>();
  for (const row of accountRows) {
    const list = byCustomer.get(row.customerId);
    if (list) list.push(row);
    else byCustomer.set(row.customerId, [row]);
  }

  /**
   * Chế độ `all` bổ sung khách CHƯA có tài khoản `done` nào.
   *
   * Thêm sau khi đã gom tài khoản, và chỉ thêm khoá rỗng: khách đã có tài khoản
   * thì giữ nguyên danh sách tài khoản của họ, không ghi đè thành mảng rỗng.
   *
   * Trần đếm chung với nhóm trên — `SCORING_EXPORT_LIMIT` là trần của cả lượt
   * xuất, không phải trần của từng nhóm.
   */
  const customerWhere = include === "all" ? customerOnlyWhere(actor, filters, scope) : null;
  if (customerWhere !== null) {
    const extra = await db
      .select({ id: customers.id })
      .from(customers)
      .where(customerWhere)
      .limit(SCORING_EXPORT_LIMIT);
    for (const row of extra) if (!byCustomer.has(row.id)) byCustomer.set(row.id, []);
  }

  const ids = [...byCustomer.keys()];
  if (ids.length === 0) return { rows: [], total: 0 };

  const ownerDepartment = alias(departments, "owner_department");
  const [customerRows, phoneRows, insuranceRows, grantRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        fullName: customers.fullName,
        idNumber: customers.idNumber,
        channelName: channels.name,
        channelCode: channels.code,
        channelDetail: customers.channelDetail,
        staffCode: users.staffCode,
        departmentName: ownerDepartment.name,
        departmentCode: ownerDepartment.code,
      })
      .from(customers)
      .leftJoin(channels, eq(channels.id, customers.channelId))
      .leftJoin(users, eq(users.id, customers.createdBy))
      .leftJoin(ownerDepartment, eq(ownerDepartment.id, customers.createdByDepartmentId))
      .where(inArray(customers.id, ids)),
    db
      .select({ customerId: customerPhones.customerId, number: customerPhones.number })
      .from(customerPhones)
      .where(and(inArray(customerPhones.customerId, ids), eq(customerPhones.isPrimary, true))),
    db
      .select({
        customerId: insuranceOrders.customerId,
        product: insuranceOrders.product,
        packageName: insuranceOrders.packageName,
        licensePlate: insuranceOrders.licensePlate,
        beneficiaryName: insuranceOrders.beneficiaryName,
      })
      .from(insuranceOrders)
      .where(inArray(insuranceOrders.customerId, ids)),
    db
      .select({
        customerId: giftGrants.customerId,
        chosenItem: giftGrants.chosenItem,
        itemName: giftItems.name,
      })
      .from(giftGrants)
      .leftJoin(giftItems, eq(giftItems.code, giftGrants.chosenItem))
      .where(inArray(giftGrants.customerId, ids)),
  ]);

  const customerById = new Map(customerRows.map((c) => [c.id, c]));
  const phoneById = new Map(phoneRows.map((p) => [p.customerId, p.number]));
  const grantById = new Map(grantRows.map((g) => [g.customerId, g]));
  const insuranceById = new Map<string, (typeof insuranceRows)[number]>();
  // Một khách có thể nhiều đơn; file Kế toán một dòng một khách nên lấy đơn đầu.
  for (const order of insuranceRows)
    if (!insuranceById.has(order.customerId)) insuranceById.set(order.customerId, order);

  const rows: ScoringExportRow[] = [];
  for (const [customerId, accounts] of byCustomer) {
    const customer = customerById.get(customerId);
    const grant = grantById.get(customerId);
    const insurance = insuranceById.get(customerId);

    const dates = accounts.map((a) => a.openedDate).filter((d): d is string => Boolean(d));
    const firstDate = dates.sort()[0] ?? "";

    const scoring: ScoringAccount[] = accounts.map((a) => ({
      customerId,
      bankCode: a.bankCode,
      appInstalled: a.appInstalled,
      openedDate: a.openedDate ?? "",
      household: a.accountType,
    }));

    const granted = new Map([[customerId, grant?.chosenItem ?? null]]);
    const month = firstDate.slice(0, 7);
    const gift = firstDate
      ? giftFor(
          {
            accounts: scoring,
            channelCodes: customer?.channelCode ? [customer.channelCode] : [],
            departmentCode: customer?.departmentCode ?? null,
            grantedItem: grant?.chosenItem ?? null,
          },
          firstDate,
        )
      : null;

    /**
     * Bốn cột đếm của file — `AN` `AO` `AP` `AQ`. Chúng đếm khối MỞ TÀI KHOẢN,
     * KHÔNG đếm khối app cài; `CNKD`/`HKD` nằm ngoài phép đếm.
     */
    const bankCodes = [...new Set(accounts.map((a) => a.bankCode))].filter(
      (code) => !HOUSEHOLD_CODES.has(code),
    );
    const tierCount = (tier: string) =>
      bankCodes.filter((code) => bankTierFor(code, firstDate) === tier).length;

    const comboPoints = comboPointsAt(bankCodes, firstDate);
    const total = month ? bankingPointsFor(scoring, month, granted) : 0;

    const household =
      accounts.find((a) => a.accountType !== "none")?.accountType ??
      (accounts.some((a) => a.bankCode === "CNKD")
        ? "CNKD"
        : accounts.some((a) => a.bankCode === "HKD")
          ? "HKD"
          : "");

    rows.push({
      customerId,
      customerName: customer?.fullName ?? "",
      idNumber: omitPii ? "" : (customer?.idNumber ?? ""),
      phone: omitPii ? "" : (phoneById.get(customerId) ?? ""),
      date: firstDate,
      hamlet: hamletOf(customer?.channelDetail ?? ""),
      channelName: customer?.channelName ?? "",
      openedBanks: bankCodes,
      // File chỉ có ô STK cho MSB; hai mã MSB dùng chung một ô.
      msbAccountNumber:
        accounts.find((a) => a.bankCode.startsWith("MSB"))?.accountNumber ?? "",
      household: household === "none" ? "" : household,
      // Khử trùng như `bankCodes`: khách có hai tài khoản cùng một ngân hàng
      // thì ô app cài vẫn là một, y hệt file Kế toán ghi mỗi ngân hàng một ô.
      installedBanks: [
        ...new Set(accounts.filter((a) => a.appInstalled).map((a) => a.bankCode)),
      ].filter((code) => !HOUSEHOLD_CODES.has(code)),
      giftReport: grant?.itemName ?? (gift?.caseCode ? (GIFT_REPORT_LABEL[gift.caseCode] ?? "") : ""),
      giftCombo: gift?.caseCode ? (GIFT_COMBO_LABEL[gift.caseCode] ?? "") : "",
      speaker: grant?.chosenItem === "QUA-LOA" ? "LOA" : "",
      insuranceLabel: insurance
        ? insuranceLabelOf(insurance.product, insurance.packageName)
        : "",
      licensePlate: insurance?.licensePlate ?? "",
      beneficiaryName: insurance?.beneficiaryName ?? "",
      staffCode: customer?.staffCode ?? "",
      departmentName: customer?.departmentName ?? "",
      priorityCount: tierCount("priority"),
      otherCount: tierCount("other"),
      restrictedCount: tierCount("restricted"),
      // Tách hai cột như file: tổ hợp 2 và tổ hợp 3 không bao giờ cùng có giá trị.
      combo2Points: bankCodes.length === 2 ? comboPoints : 0,
      combo3Points: bankCodes.length >= 3 ? comboPoints : 0,
      householdPoints: Number((total - comboPoints).toFixed(2)),
      totalPoints: total,
    });
  }

  /**
   * `total` phải đếm ĐÚNG tập khách của chế độ đang chạy, vì nơi gọi so nó với
   * số dòng nhận về để biết đã chạm trần chưa. Đếm nhầm tập thì file thiếu dòng
   * mà không ai được báo.
   */
  const [totals] =
    customerWhere === null
      ? await db
          .select({ value: sql<number>`count(distinct ${bankAccounts.customerId})::int` })
          .from(bankAccounts)
          .where(done)
      : await db
          .select({ value: count() })
          .from(customers)
          .where(
            or(
              customerWhere,
              exists(
                db
                  .select({ one: sql`1` })
                  .from(bankAccounts)
                  .where(and(done, eq(bankAccounts.customerId, customers.id))),
              ),
            ),
          );

  return { rows, total: totals?.value ?? rows.length };
}

/* ── Báo cáo #4 · Số liệu cấp đơn bảo hiểm ──────────────────────────── */

/**
 * Dựng lại hai file Kế toán đang làm tay: `Bao cao so lieu cap don Thang 08` và
 * bản `theo phong`. Cùng một bộ số, gộp theo hai trục khác nhau.
 *
 * Phạm vi luôn là TRỌN một tháng. "Theo ngày" hay "theo tháng" chỉ đổi cách
 * chia sheet ở giao diện, không đổi khoảng thời gian (chốt 2026-09-01).
 */

/** Trục gộp — phòng ghi nhận lúc tạo đơn, hoặc người tạo đơn. */
export type OrderStatsGroupBy = "department" | "staff";

/** Mã món quà đếm vào hai cột BHSK. */
const HEALTH_GIFT_CODE = "QUA-BH-SUC-KHOE";

/**
 * Một ô của báo cáo: một NGÀY, một nhóm, mười con số.
 *
 * Trả theo ngày kể cả khi người dùng chọn gộp tháng — nơi gọi tự cộng lại. Gộp
 * sẵn ở máy chủ thì phải chạy hai câu truy vấn khác nhau cho hai kiểu sheet, mà
 * hai câu đó sớm muộn lệch nhau.
 */
export type OrderStatsCell = {
  /** `YYYY-MM-DD` — ngày tạo đơn, cũng là ngày phát quà. */
  day: string;
  groupId: string;
  motorbike: number;
  motorbikeYears: number;
  electric100: number;
  electric200: number;
  health: number;
  motorbikeCancelled: number;
  motorbikeYearsCancelled: number;
  electric100Cancelled: number;
  electric200Cancelled: number;
  healthCancelled: number;
};

/** `department` chỉ có ở trục nhân viên — cột PHÒNG cạnh cột HỌ VÀ TÊN. */
export type OrderStatsGroup = { id: string; label: string; department?: string };

export type OrderStatsResult = {
  /** Đúng thứ tự hiện trong sheet. Nhóm không có số nào vẫn nằm đây khi gộp theo phòng. */
  groups: OrderStatsGroup[];
  cells: OrderStatsCell[];
};

const emptyCell = (day: string, groupId: string): OrderStatsCell => ({
  day,
  groupId,
  motorbike: 0,
  motorbikeYears: 0,
  electric100: 0,
  electric200: 0,
  health: 0,
  motorbikeCancelled: 0,
  motorbikeYearsCancelled: 0,
  electric100Cancelled: 0,
  electric200Cancelled: 0,
  healthCancelled: 0,
});

/**
 * Số năm của một đơn xe máy, suy từ hai cột ngày — cùng công thức worker PVI
 * dùng lúc điền form (`pvi-qlcd-playwright/worker.ts`). PVI cấp tối đa 3 năm.
 *
 * Tính trong SQL chứ không kéo từng đơn về Node: một tháng thật có hơn ba vạn
 * đơn, mà báo cáo chỉ cần tổng.
 */
const YEARS_SQL = sql<number>`greatest(1, least(3, round((${insuranceOrders.endDate} - ${insuranceOrders.startDate}) / 365.25)))`;

/**
 * Số liệu cấp đơn của MỘT tháng, chưa gộp ngày.
 *
 * ⚠️ Đơn HUỶ tính vào NGÀY TẠO ĐƠN, không phải ngày bấm huỷ (chốt 2026-09-01).
 * Nhờ vậy cột "đã dùng" và cột "đã huỷ" của cùng một ngày nói về cùng một tập
 * đơn, cộng lại ra đúng số đơn nhập ngày đó.
 */
export async function listOrderStats(
  month: string,
  groupBy: OrderStatsGroupBy,
): Promise<OrderStatsResult> {
  const from = `${month}-01`;
  const to = sql`(${from}::date + interval '1 month')::date`;

  const groupKey =
    groupBy === "department"
      ? sql<string>`coalesce(${insuranceOrders.createdByDepartmentId}::text, '')`
      : sql<string>`coalesce(${insuranceOrders.createdBy}::text, '')`;

  const orderRows = await db
    .select({
      day: sql<string>`${insuranceOrders.orderDate}::text`,
      groupId: groupKey,
      cancelled: sql<boolean>`${insuranceOrders.status} = 'cancelled'`,
      motorbike: sql<number>`count(*) filter (where ${insuranceOrders.product} = 'motorbike')::int`,
      motorbikeYears: sql<number>`coalesce(sum(${YEARS_SQL}) filter (where ${insuranceOrders.product} = 'motorbike'), 0)::int`,
      // Hai mức phí của BH tai nạn điện là 100.000 và 200.000 chẵn, không có
      // mức nào ở giữa — xem `insurance_package_legs`.
      electric100: sql<number>`count(*) filter (where ${insuranceOrders.product} = 'electric-accident' and ${insuranceOrders.fee} < 200000)::int`,
      electric200: sql<number>`count(*) filter (where ${insuranceOrders.product} = 'electric-accident' and ${insuranceOrders.fee} >= 200000)::int`,
    })
    .from(insuranceOrders)
    .where(
      and(
        sql`${insuranceOrders.orderDate} >= ${from}::date`,
        sql`${insuranceOrders.orderDate} < ${to}`,
      ),
    )
    .groupBy(sql`1`, sql`2`, sql`3`);

  const cells = new Map<string, OrderStatsCell>();
  const cellOf = (day: string, groupId: string): OrderStatsCell => {
    const key = `${day}|${groupId}`;
    const found = cells.get(key);
    if (found) return found;
    const made = emptyCell(day, groupId);
    cells.set(key, made);
    return made;
  };

  for (const r of orderRows) {
    const cell = cellOf(r.day, r.groupId);
    if (r.cancelled) {
      cell.motorbikeCancelled += r.motorbike;
      cell.motorbikeYearsCancelled += r.motorbikeYears;
      cell.electric100Cancelled += r.electric100;
      cell.electric200Cancelled += r.electric200;
    } else {
      cell.motorbike += r.motorbike;
      cell.motorbikeYears += r.motorbikeYears;
      cell.electric100 += r.electric100;
      cell.electric200 += r.electric200;
    }
  }

  await addHealthGiftCounts(cells, cellOf, month, groupBy);

  return { groups: await groupsOf(groupBy, cells), cells: [...cells.values()] };
}

/**
 * Hai cột BHSK — đếm món quà `BH sức khoẻ` đã phát, không đếm đơn bảo hiểm
 * (chốt 2026-09-01). Hệ thống không có sản phẩm bảo hiểm sức khoẻ; `BH sức
 * khoẻ` là một món trong rổ quà.
 *
 * Cột "đã dùng" đọc `gift_grants.chosen_item`, cột "huỷ" đọc lượt ĐỔI đi khỏi
 * món đó. Hai cột tự loại trừ nhau: `chosen_item` giữ món HIỆN TẠI, nên khách
 * đổi sang món khác rời cột đầu và vào cột sau.
 *
 * ⚠️ Phòng lấy từ `users.department_id` HIỆN TẠI của người phát, không phải
 * phòng lúc phát. Khác đơn bảo hiểm, `gift_grants` không chụp phòng lúc ghi.
 */
async function addHealthGiftCounts(
  cells: Map<string, OrderStatsCell>,
  cellOf: (day: string, groupId: string) => OrderStatsCell,
  month: string,
  groupBy: OrderStatsGroupBy,
): Promise<void> {
  const from = `${month}-01`;
  // `granted_at` là timestamptz, máy chủ chạy UTC. Không quy múi giờ thì đơn
  // phát lúc 0h–7h sáng rơi sang ngày hôm trước.
  const vnDay = (column: SQLWrapper) =>
    sql<string>`((${column} at time zone ${BUSINESS_TIMEZONE})::date)::text`;
  const inMonth = (column: SQLWrapper) =>
    sql`(${column} at time zone ${BUSINESS_TIMEZONE})::date >= ${from}::date
        and (${column} at time zone ${BUSINESS_TIMEZONE})::date < (${from}::date + interval '1 month')::date`;

  const granter = alias(users, "granter");
  const changer = alias(users, "changer");
  const keyOf = (u: { departmentId: SQLWrapper; id: SQLWrapper }) =>
    groupBy === "department"
      ? sql<string>`coalesce(${u.departmentId}::text, '')`
      : sql<string>`coalesce(${u.id}::text, '')`;

  const [granted, changed] = await Promise.all([
    db
      .select({
        day: vnDay(giftGrants.grantedAt),
        groupId: keyOf(granter),
        total: sql<number>`count(*)::int`,
      })
      .from(giftGrants)
      .innerJoin(granter, eq(granter.id, giftGrants.grantedBy))
      .where(and(eq(giftGrants.chosenItem, HEALTH_GIFT_CODE), inMonth(giftGrants.grantedAt)))
      .groupBy(sql`1`, sql`2`),
    db
      .select({
        day: vnDay(giftGrantChanges.changedAt),
        groupId: keyOf(changer),
        total: sql<number>`count(*)::int`,
      })
      .from(giftGrantChanges)
      .innerJoin(changer, eq(changer.id, giftGrantChanges.changedBy))
      .where(
        and(
          eq(giftGrantChanges.fromChosenItem, HEALTH_GIFT_CODE),
          inMonth(giftGrantChanges.changedAt),
        ),
      )
      .groupBy(sql`1`, sql`2`),
  ]);

  for (const r of granted) cellOf(r.day, r.groupId).health += r.total;
  for (const r of changed) cellOf(r.day, r.groupId).healthCancelled += r.total;
  void cells;
}

/**
 * Danh sách dòng của báo cáo, đúng thứ tự hiện trong sheet.
 *
 * Gộp theo PHÒNG thì liệt kê MỌI phòng kinh doanh, kể cả phòng không có đơn nào
 * (chốt 2026-09-01) — file Kế toán giữ đủ dòng để so ngang giữa các ngày.
 *
 * Gộp theo NHÂN VIÊN thì chỉ liệt kê người có số liệu: công ty vài trăm người
 * mà một ngày chỉ vài người nhập đơn.
 *
 * Nhóm nào có số liệu mà không nằm trong danh sách chuẩn vẫn được thêm vào
 * cuối. Cắt đi thì dòng TỔNG không khớp tổng các dòng trên, mà người đọc không
 * có cách nào biết vì sao.
 */
async function groupsOf(
  groupBy: OrderStatsGroupBy,
  cells: Map<string, OrderStatsCell>,
): Promise<OrderStatsGroup[]> {
  const used = new Set([...cells.values()].map((c) => c.groupId));

  if (groupBy === "department") {
    const rows = await db
      .select({ id: departments.id, label: departments.name })
      .from(departments)
      .where(and(eq(departments.type, "sales"), eq(departments.active, true)))
      .orderBy(departments.name);

    const listed = new Set(rows.map((r) => r.id));
    const extraIds = [...used].filter((id) => id && !listed.has(id));
    const extras = extraIds.length
      ? await db
          .select({ id: departments.id, label: departments.name })
          .from(departments)
          .where(inArray(departments.id, extraIds))
      : [];

    return [
      ...rows,
      ...extras,
      // Đơn không gắn phòng nào — ban giám đốc tạo, hoặc dữ liệu cũ.
      ...(used.has("") ? [{ id: "", label: "Không thuộc phòng" }] : []),
    ];
  }

  const ids = [...used].filter(Boolean);
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: users.id,
      label: users.fullName,
      // Phòng HIỆN TẠI của người nhập (chốt 2026-09-02) — hai cột BHSK vốn đã
      // gộp theo phòng hiện tại (xem `addHealthGiftCounts`), lấy cùng nguồn
      // thì cột PHÒNG không mâu thuẫn với chính số liệu trên dòng.
      department: sql<string>`coalesce(${departments.name}, '')`,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(inArray(users.id, ids))
    .orderBy(users.fullName);

  return [
    ...rows,
    ...(used.has("") ? [{ id: "", label: "Không rõ người tạo", department: "" }] : []),
  ];
}
