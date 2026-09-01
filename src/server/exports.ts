import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bankingPointsFor, bankTierFor, comboPointsAt, giftFor } from "@/rules";
import type { ScoringAccount } from "@/rules";
import type { User } from "@/lib/types";
import { accountExportWhere } from "./banking";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  channels,
  customerPhones,
  customers,
  departments,
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
 * 320 dòng bỏ trống. Sáu chuỗi dưới đây chép từ giá trị xuất hiện nhiều nhất
 * trong file. Kế toán đổi cách ghi thì sửa ở đây.
 */
const GIFT_REPORT_LABEL: Record<string, string> = {
  TH1: "1 NĂM BH + 20K (Khi cài đặt được VPa) - COMBO 2,3",
  TH2: "1 NĂM BH - COMBO 2",
  TH3: "1 NĂM BH + 70K (Khi cài đặt được VPa và MSBa) - COMBO 3",
  TH4: "1 NĂM BH + 50K (Khi cài đặt được MSBa) - COMBO 3",
  TH5: "2 NĂM BH + 20K (Khi cài đặt được VPa và MSBb) - COMBO 3",
  TH6: "2 NĂM BH (Không thuộc các trường hợp trên hoặc thiết bị không phù hợp)",
};

/** Nhãn ngắn của cột `QUÀ TẶNG THEO COMBO`, cùng chữ với công thức `AG` của file. */
const GIFT_COMBO_LABEL: Record<string, string> = {
  TH1: "1 năm BH + 20k",
  TH2: "1 năm BH",
  TH3: "1 năm BH + 70k",
  TH4: "1 năm BH + 50k",
  TH5: "2 năm BH + 20k",
  TH6: "2 năm BH",
};

export async function listScoringExport(
  actor: User,
  filters: BankAccountFilters,
): Promise<{ rows: ScoringExportRow[]; total: number }> {
  const where = await accountExportWhere(actor, filters);
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
      idNumber: customer?.idNumber ?? "",
      phone: phoneById.get(customerId) ?? "",
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
      giftReport: grant?.itemName ?? (gift?.caseCode ? GIFT_REPORT_LABEL[gift.caseCode] : ""),
      giftCombo: gift?.caseCode ? GIFT_COMBO_LABEL[gift.caseCode] : "",
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

  const [totals] = await db
    .select({ value: sql<number>`count(distinct ${bankAccounts.customerId})::int` })
    .from(bankAccounts)
    .where(done);

  return { rows, total: totals?.value ?? rows.length };
}
