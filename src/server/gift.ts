import { and, asc, count, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { GIFT_DECLINED, GIFT_DECLINED_LABEL, GIFT_ERROR, type GiftChangeForm } from "@/lib/api/customers";
import { GIFT_EXPORT_LIMIT, type GiftGrantRow } from "@/lib/api/gifts";
import type { Page } from "@/lib/api/pagination";
import { EMPTY_GIFT, GiftSimulateResult, type GiftSimulateInput } from "@/lib/api/settings";
import { BUSINESS_TIMEZONE, businessDay, businessMonth } from "@/lib/format";
import { recordVisibility } from "@/lib/permissions";
import { isRealIsoDate, type User } from "@/lib/types";
import type { PageArgs } from "./pagination";
import {
  bankingPointsFor,
  giftFor,
  householdPointsAt,
  type GiftInput,
  type GiftResult,
} from "@/rules";
import { db } from "./db/client";
import { recomputeKpiForCustomer } from "./kpi";
import {
  bankAccounts,
  banks,
  channels,
  customers,
  departments,
  giftGrantChanges,
  giftGrants,
  giftItems,
  insuranceOrderStatusHistory,
  insuranceOrders,
  insurancePackages,
  users,
} from "./db/schema";

/**
 * Cầu nối giữa module luật và ứng dụng — MỘT chỗ duy nhất, dùng chung cho P-42
 * (hồ sơ khách), P-43 (chốt quà) và P-81 (nút Thử).
 *
 * Việc của nó đúng hai điều: gom dữ liệu khách thành dạng hàm luật cần, rồi đổi
 * MÃ món trong kết quả sang tên trong danh mục. Không có mảnh luật nào ở đây —
 * luật nằm trọn ở `src/rules/`, tra bằng ngày để kỳ nào ra luật kỳ đó.
 */

/**
 * Vào của hàm luật, gom từ database cho MỘT khách.
 *
 * Ba nguồn:
 * - tài khoản `done` (tài khoản đang tạo dở chưa phải tài khoản thật),
 * - kênh: kênh của khách CỘNG kênh của từng tài khoản, vì mỗi tài khoản mở qua
 *   một kênh riêng và kênh Bệnh viện góp thêm món vào rổ (spec §5.2 bước 2),
 * - phòng của NGƯỜI LẬP HỒ SƠ KHÁCH, cùng trục với điểm KPI (câu 7.11) — chứ
 *   không phải phòng của người bấm nút xem. Đọc cột
 *   `customers.created_by_department_id`, và `writeStaff` viết lại cột đó khi
 *   người lập hồ sơ chuyển phòng, nên rổ quà đi theo người (chốt 13/08).
 */
export async function giftInputFor(customerId: string): Promise<GiftInput> {
  const [accountRows, [customerRow]] = await Promise.all([
    db
      .select({
        bankCode: banks.code,
        appInstalled: bankAccounts.appInstalled,
        openedDate: bankAccounts.openedDate,
        // Ô chọn "Mở tài khoản CNKD / HKD" nằm trên chính dòng VPa. Không lấy
        // cột này thì luật không thấy ô chọn đó, và khách mất Loa + Bảng mica.
        accountType: bankAccounts.accountType,
        channelCode: channels.code,
      })
      .from(bankAccounts)
      .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
      .leftJoin(channels, eq(channels.id, bankAccounts.channelId))
      .where(and(eq(bankAccounts.customerId, customerId), eq(bankAccounts.status, "done"))),
    db
      .select({ channelCode: channels.code, departmentCode: departments.code })
      .from(customers)
      .leftJoin(channels, eq(channels.id, customers.channelId))
      .leftJoin(departments, eq(departments.id, customers.createdByDepartmentId))
      .where(eq(customers.id, customerId)),
  ]);

  const channelCodes = new Set<string>();
  if (customerRow?.channelCode) channelCodes.add(customerRow.channelCode);
  for (const row of accountRows) if (row.channelCode) channelCodes.add(row.channelCode);

  return {
    accounts: accountRows.map((r) => ({
      customerId,
      bankCode: r.bankCode,
      appInstalled: r.appInstalled,
      openedDate: r.openedDate ?? "",
      household: r.accountType,
    })),
    // Nơi gọi biết món đã phát thì tự ghi đè — xem `giftResultOf`.
    grantedItem: null,
    channelCodes: [...channelCodes],
    departmentCode: customerRow?.departmentCode ?? null,
  };
}

/**
 * Tra danh mục để lấy TÊN và tình trạng cấp phát của từng mã món.
 *
 * Hàm luật đóng băng nên chỉ trỏ bằng MÃ (`BH-1N-XEMAY`, `QUA-NON-BH`); tên thì
 * admin sửa được bất cứ lúc nào, và công tắc bật/tắt cũng nằm ở danh mục.
 *
 * Hai tầng, hai việc, không tầng nào phải biết việc của tầng kia:
 * - **luật** quyết định khách XỨNG ĐÁNG nhận gì,
 * - **danh mục** quyết định món đó CÒN CẤP ĐƯỢC không.
 *
 * Nên hàm này KHÔNG lọc bỏ món nào, chỉ gắn cờ. Bản trước lọc bỏ món tắt và
 * món mất khỏi danh mục, hệ quả là rổ 4 món tụt còn 2 mà màn không có gì để
 * nói — người dùng không phân biệt được "khách không đủ điều kiện" với "món
 * hết hàng". Ai chặn phát là việc của `grantGift`.
 */
async function resolveBasket(items: GiftResult["basket"]) {
  const packageCodes = items.filter((i) => i.kind === "insurance-package").map((i) => i.code);
  const itemCodes = items.filter((i) => i.kind === "gift-item").map((i) => i.code);

  const [packageRows, itemRows] = await Promise.all([
    packageCodes.length === 0
      ? []
      : db
          .select({
            id: insurancePackages.id,
            code: insurancePackages.code,
            name: insurancePackages.name,
            active: insurancePackages.active,
          })
          .from(insurancePackages)
          .where(inArray(insurancePackages.code, packageCodes)),
    itemCodes.length === 0
      ? []
      : db
          .select({
            id: giftItems.id,
            code: giftItems.code,
            name: giftItems.name,
            active: giftItems.active,
          })
          .from(giftItems)
          .where(inArray(giftItems.code, itemCodes)),
  ]);

  const byCode = new Map([...packageRows, ...itemRows].map((r) => [r.code, r]));

  // KHÔNG lọc bỏ món nào. Món tắt hoặc mất khỏi danh mục vẫn đi ra, mang cờ
  // `status` — "khách đủ điều kiện nhận" và "món còn cấp được" là hai chuyện
  // khác nhau, gộp lại thì rổ hụt món mà màn không có gì để nói.
  return items.map((item) => {
    const row = byCode.get(item.code);
    if (!row)
      return {
        id: null,
        code: item.code,
        name: item.code,
        source: item.reason,
        status: "missing" as const,
        cashIfChosen: item.cashIfChosen,
      };
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      source: item.reason,
      status: row.active ? ("ok" as const) : ("discontinued" as const),
      cashIfChosen: item.cashIfChosen,
    };
  });
}

/**
 * Chạy luật rồi nắn về hình dạng giao diện đọc được.
 *
 * `at` là ngày tra luật — mặc định hôm nay theo giờ Việt Nam. P-43 truyền ngày
 * chốt quà vào đây để đợt đã phát luôn tính lại ra đúng luật lúc phát.
 */
export async function giftResultOf(
  input: GiftInput,
  at: string = businessDay(),
  grantedItem: string | null = null,
): Promise<GiftSimulateResult> {
  // Món đã phát đổi phần tiền mặt từ kỳ 2026-09 (`soloCashOf`), nên phải vào
  // TẬN hàm luật chứ không chỉ dùng cho điểm CNKD như trước.
  const result = giftFor({ ...input, grantedItem }, at);
  // Kỳ chưa có file luật: trả rổ rỗng KÈM một câu nói rõ vì sao. Rỗng mà im
  // lặng thì màn hiện "Chưa đủ điều kiện" cho một khách có thể đang đủ.
  if (!result)
    return { ...EMPTY_GIFT, explain: [`Ngày ${at} chưa có thể lệ nào trong hệ thống.`] };

  const householdPoints = householdPointsAt(input.accounts, at, grantedItem);

  /**
   * TỔNG điểm chạy qua đúng cửa `bankingPointsFor`, không cộng tay hai phần.
   *
   * Hai số kia trả điểm của PHẦN mình, còn hàm này áp cả luật hồ sơ sai: khách
   * mở cả `VPa` lẫn `VPb` bị cắt trọn điểm dù từng phần vẫn ra số. Cộng tay là
   * màn hiện một con số không ai được trả.
   *
   * `at` cắt còn `YYYY-MM` vì `bankingPointsFor` lọc theo tháng (câu 7.13), mà
   * mọi tài khoản của màn thử đều mang ngày mở bằng đúng ngày tra luật.
   */
  const totalPoints = bankingPointsFor(input.accounts, at.slice(0, 7), new Map());

  /**
   * Chỉ để VIẾT CÂU giải thích, không tham gia phép tính — con số vẫn do
   * `bankingPointsFor` quyết.
   *
   * Kiểm thẳng hình dạng hồ sơ chứ không so `totalPoints` với tổng hai phần:
   * hai số đó còn lệch nhau ở ca khách mở tài khoản vắt hai tháng, mà ca đó
   * không sai gì cả.
   */
  const bothVpModes =
    input.accounts.some((a) => a.bankCode === "VPa") &&
    input.accounts.some((a) => a.bankCode === "VPb");

  return {
    caseCode: result.caseCode,
    insuranceYears: result.insuranceYears,
    cashTotal: result.cashTotal,
    cashBreakdown: result.cash.map((c) => ({
      label: `${c.bankCode}, chi trong ${c.withinDays} ngày`,
      amount: c.amount,
    })),
    basket: await resolveBasket(result.basket),
    kpiPoints: result.comboPoints,
    kpiBreakdown:
      result.comboPoints > 0
        ? [{ label: `Combo ${result.caseCode ?? ""}`.trim(), points: result.comboPoints }]
        : [],
    householdPoints,
    householdNote: householdNoteOf(householdPoints, grantedItem),
    totalPoints,
    pointsNote: bothVpModes
      ? "Hồ sơ khách sai nên không được tính điểm nào. Khách không thể vừa mở VPa vừa mở VPb — hai mã là hai cách đăng ký của cùng một ngân hàng."
      : "",
    explain: result.explain,
    giftNote: result.giftNote ?? "",
  };
}

/**
 * Vì sao điểm CNKD ra đúng mức đó — bốn dòng của bảng mục 4c.
 *
 * Đọc từ CON SỐ chứ không tính lại điều kiện: tính lại là dựng bản sao thứ hai
 * của luật ở tầng máy chủ, và hai bản sao sớm muộn lệch nhau.
 */
function householdNoteOf(points: number, grantedItem: string | null): string {
  if (points === 0) return "";
  if (points === 1.5) return "CNKD, mở đúng 1 ngân hàng, chưa nhận Mì hoặc Nón";
  if (points === 0.7)
    return `CNKD, mở đúng 1 ngân hàng, đã nhận ${grantedItem === "QUA-MI" ? "Mì" : "Nón"} nên xuống mức 0,7`;
  return "CNKD, mở từ 2 ngân hàng";
}

/** Hai danh sách mã quà giống nhau không — thứ tự luật sinh ra ổn định nên so thẳng. */
const sameCodes = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((code, i) => code === b[i]);

/**
 * P-42 và P-43 — quà của một khách có thật trong database.
 *
 * Đọc thêm món khách ĐÃ nhận: từ chốt 2026-08-24 nó đổi mức điểm CNKD (thể lệ
 * mục 4c). Bỏ qua thì hồ sơ khách hiện 1,5 cho người đã nhận Mì, trong khi bảng
 * lương tính 0,7.
 */
export async function giftForCustomer(
  customerId: string,
  /**
   * Món ĐANG chọn của một lượt phát chưa ghi vào database.
   *
   * Bỏ trống thì đọc món đã phát từ `gift_grants`. Truyền vào để biết số tiền
   * SẼ chi nếu chốt món đó — `grantGift` và `changeGift` cần con số ấy trước
   * khi ghi, xem `soloCashOf` của kỳ 2026-09.
   */
  choosing?: string,
): Promise<GiftSimulateResult> {
  const [input, [grant]] = await Promise.all([
    giftInputFor(customerId),
    db
      .select({ chosenItem: giftGrants.chosenItem })
      .from(giftGrants)
      .where(eq(giftGrants.customerId, customerId))
      .limit(1),
  ]);
  return giftResultOf(input, businessDay(), choosing ?? grant?.chosenItem ?? null);
}

/**
 * Ghi lại `customers.gift_case` cho MỘT khách.
 *
 * ⚠️ MỌI ĐƯỜNG GHI ĐỔI TÀI KHOẢN `done` CỦA KHÁCH ĐỀU PHẢI GỌI HÀM NÀY, cùng
 * lối với `recomputeKpi`. Sót một nhánh nghĩa là P-40 hiện sai trạng thái quà
 * và P-80 đếm sai số khách chờ phát — sai lặng lẽ, không ai báo.
 *
 * Chỉ cần tài khoản: kênh và phòng đổi món trong rổ chứ không đổi trường hợp,
 * nên sửa kênh của khách không phải tính lại.
 *
 * Đợt đã chốt thì KHÔNG đụng vào: `gift_grants` mới là chỗ nói khách đã nhận
 * quà, còn cột này chỉ trả lời "khách đang khớp trường hợp nào".
 */
export async function recomputeGiftCase(customerId: string): Promise<void> {
  const input = await giftInputFor(customerId);
  const result = giftFor(input, businessDay());

  await db
    .update(customers)
    .set({ giftBasket: result?.basket.map((b) => b.code) ?? [] })
    .where(eq(customers.id, customerId));
}

/**
 * P-81 — chạy thử trên dữ liệu người dùng tự bịa, KHÔNG đụng database.
 *
 * `customerId` là chuỗi giả: hàm luật gom theo khách, mà ở đây chỉ có đúng một
 * khách tưởng tượng nên mọi dòng mang chung một khoá.
 */
export const giftSimulate = (input: GiftSimulateInput): Promise<GiftSimulateResult> =>
  giftResultOf(
    {
      accounts: input.accounts.map((a) => ({
        customerId: "simulate",
        bankCode: a.bankCode,
        appInstalled: a.appInstalled,
        // Ngày mở = ngày tra luật, để tài khoản luôn nằm trong kỳ đang thử.
        openedDate: input.at || businessDay(),
        // Nắn lại như `finishBankAccount`: CNKD/HKD chỉ có nghĩa với VPa và
        // VPb, ô chọn chỉ hiện trên hai thẻ đó nhưng request nặn tay thì không.
        //
        // `VPb` thêm từ kỳ 2026-09: lưu ý 3 cho CNKD chọn VPBb, và Kế toán chốt
        // 2026-09-02 rằng HKD cũng mở khoá VPb.
        household: a.bankCode === "VPa" || a.bankCode === "VPb" ? a.accountType : "none",
      })),
      channelCodes: input.channelCodes,
      departmentCode: input.departmentCode,
      // `giftResultOf` ghi đè bằng tham số thứ ba; dòng này chỉ cho đủ kiểu.
      grantedItem: input.grantedItem,
    },
    input.at || businessDay(),
    input.grantedItem,
  );

/**
 * Tính lại `customers.gift_case` cho TOÀN BỘ khách — `bun run db:recount`.
 *
 * Không đi qua `recomputeGiftCase` từng người: hàm đó tốn hai câu truy vấn mỗi
 * khách, mà ở 250.000 khách là nửa triệu lượt đi về database. Ở đây kéo theo
 * TỪNG LÔ rồi tính trong bộ nhớ.
 *
 * Chỉ ghi những dòng THẬT SỰ lệch, và trả về đúng danh sách đó — sửa im lặng
 * thì lần sau lệch nữa cũng không ai biết đã lệch bao nhiêu lần rồi.
 */
export async function recountGiftCases(
  batchSize = 2_000,
): Promise<{ id: string; from: string[]; to: string[] }[]> {
  const today = businessDay();
  const drift: { id: string; from: string[]; to: string[] }[] = [];

  for (let offset = 0; ; offset += batchSize) {
    /**
     * Lô phải kéo về CẢ BA nguồn của hàm luật: tài khoản, kênh, phòng.
     *
     * Bản trước truyền `channelCodes: []` và `departmentCode: null` với lý do
     * "kênh và phòng chỉ đổi món trong rổ, không đổi trường hợp". Lý do đó đúng
     * khi cột lưu MÃ BẬC. Cột nay lưu DANH SÁCH MÃ QUÀ, mà kênh và phòng đổi
     * đúng danh sách đó — bỏ chúng đi là đếm lại ra rổ thiếu món.
     */
    const batch = await db
      .select({
        id: customers.id,
        giftBasket: customers.giftBasket,
        channelCode: channels.code,
        departmentCode: departments.code,
      })
      .from(customers)
      .leftJoin(channels, eq(channels.id, customers.channelId))
      .leftJoin(departments, eq(departments.id, customers.createdByDepartmentId))
      .orderBy(customers.id)
      .limit(batchSize)
      .offset(offset);
    if (batch.length === 0) break;

    const ids = batch.map((c) => c.id);
    const accountChannel = alias(channels, "account_channel");
    const accountRows = await db
      .select({
        customerId: bankAccounts.customerId,
        bankCode: banks.code,
        appInstalled: bankAccounts.appInstalled,
        openedDate: bankAccounts.openedDate,
        accountType: bankAccounts.accountType,
        channelCode: accountChannel.code,
      })
      .from(bankAccounts)
      .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
      .leftJoin(accountChannel, eq(accountChannel.id, bankAccounts.channelId))
      .where(and(inArray(bankAccounts.customerId, ids), eq(bankAccounts.status, "done")));

    const byCustomer = new Map<string, GiftInput["accounts"]>();
    const channelsOf = new Map<string, Set<string>>();
    for (const row of accountRows) {
      const list = byCustomer.get(row.customerId) ?? [];
      list.push({
        customerId: row.customerId,
        bankCode: row.bankCode,
        appInstalled: row.appInstalled,
        openedDate: row.openedDate ?? "",
        household: row.accountType,
      });
      byCustomer.set(row.customerId, list);

      if (row.channelCode) {
        const set = channelsOf.get(row.customerId) ?? new Set<string>();
        set.add(row.channelCode);
        channelsOf.set(row.customerId, set);
      }
    }

    for (const customer of batch) {
      const codes = channelsOf.get(customer.id) ?? new Set<string>();
      if (customer.channelCode) codes.add(customer.channelCode);

      const result = giftFor(
        {
          accounts: byCustomer.get(customer.id) ?? [],
          channelCodes: [...codes],
          departmentCode: customer.departmentCode,
          // Chỉ đọc `basket`, mà rổ không phụ thuộc món đã phát.
          grantedItem: null,
        },
        today,
      );
      const next = result?.basket.map((b) => b.code) ?? [];
      if (sameCodes(next, customer.giftBasket)) continue;

      drift.push({ id: customer.id, from: customer.giftBasket, to: next });
      await db.update(customers).set({ giftBasket: next }).where(eq(customers.id, customer.id));
    }
  }

  return drift;
}

type GrantOutcome =
  /** `itemLabel` là TÊN món lúc phát — nhật ký hoạt động cần chữ đọc được, không cần mã. */
  | { ok: true; customerName: string; itemLabel: string }
  | { ok: false; code: (typeof GIFT_ERROR)[keyof typeof GIFT_ERROR]; message: string };

/**
 * Những THÁNG mà khách này có tài khoản `done` — mỗi tháng một ô điểm phải tính lại.
 *
 * Dùng khi phát quà: từ chốt 2026-08-24 món quà đổi điểm, mà điểm chia theo
 * tháng mở tài khoản (câu 7.13). Khách mở tài khoản tháng 8 lẫn tháng 9 thì cả
 * hai ô điểm đều đổi.
 */
async function accountMonthsOf(customerId: string): Promise<string[]> {
  const rows = await db
    .select({ openedDate: bankAccounts.openedDate })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.customerId, customerId), eq(bankAccounts.status, "done")));

  return [
    ...new Set(
      rows
        .map((r) => r.openedDate)
        .filter((d): d is string => Boolean(d))
        .map((d) => businessMonth(new Date(`${d}T00:00:00+07:00`))),
    ),
  ];
}

/**
 * P-43 · chốt quà cho một khách. `null` = không có khách đó.
 *
 * Ba chốt chặn, theo đúng thứ tự đắt dần:
 *
 * 1. Máy chủ TỰ TÍNH LẠI rổ quà, không tin rổ client gửi lên. Rổ có món là hợp
 *    đồng bảo hiểm hai năm — nhận tên món tuỳ ý là mở đường tự phát quà cho
 *    mình bằng một câu lệnh gõ tay.
 * 2. Món chọn phải nằm trong rổ vừa tính, trừ trường hợp khách từ chối.
 * 3. Trùng khách thì thua — `gift_grants.customer_id` là khoá duy nhất, và
 *    `onConflictDoNothing` để hai lượt bấm song song chỉ một lượt ghi được.
 *    Kiểm trước rồi mới ghi thì hai request cùng lúc đều qua chốt.
 */
export async function grantGift(
  actor: User,
  customerId: string,
  item: string,
  orderIds: string[] = [],
): Promise<GrantOutcome | null> {
  const [customer] = await db
    .select({ fullName: customers.fullName })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!customer) return null;

  const gift = await giftForCustomer(customerId);
  const declined = item === GIFT_DECLINED;

  if (gift.basket.length === 0 && !declined)
    return {
      ok: false,
      code: GIFT_ERROR.NOT_IN_BASKET,
      message: "Khách này chưa đủ điều kiện nhận quà",
    };

  // Tìm bằng MÃ, không bằng tên (quyết định #74): admin đổi tên món ở P-82 giữa
  // lúc người dùng đang mở màn phát quà thì tìm theo tên không ra, dù đúng món.
  const picked = declined ? null : gift.basket.find((b) => b.code === item);

  if (!declined && !picked)
    return {
      ok: false,
      code: GIFT_ERROR.NOT_IN_BASKET,
      message: `"${item}" không nằm trong danh sách quà của khách này`,
    };

  // Rổ giữ lại cả món đã ngừng để màn nói được lý do, nên chốt chặn phải tự
  // kiểm — ẩn nút ở giao diện không phải là chặn (AGENTS.md §6).
  if (picked && picked.status !== "ok")
    return {
      ok: false,
      code: GIFT_ERROR.ITEM_DISCONTINUED,
      message:
        picked.status === "discontinued"
          ? `"${picked.name}" đã ngừng cấp — chọn món khác trong rổ`
          : `"${picked.name}" không còn trong danh mục quà — báo quản trị thêm lại rồi phát`,
    };

  const newIds = [...new Set(orderIds)];
  // Đơn bảo hiểm được tạo TRƯỚC lượt chốt quà, nên chưa có `gift_grant_id`.
  // Kiểm tra chúng trước rồi chốt + nối trong cùng transaction: nếu một đơn
  // sai, không được để lại một lượt quà không có đơn tương ứng.
  if (newIds.length > 0) {
    const orders = await db
      .select({ id: insuranceOrders.id })
      .from(insuranceOrders)
      .where(
        and(
          inArray(insuranceOrders.id, newIds),
          eq(insuranceOrders.customerId, customerId),
          eq(insuranceOrders.source, "gift"),
          isNull(insuranceOrders.giftGrantId),
        ),
      );
    if (orders.length !== newIds.length)
      return { ok: false, code: GIFT_ERROR.NOT_IN_BASKET, message: "Đơn quà vừa tạo không hợp lệ." };
  }

  /**
   * Tính lại KÈM món vừa chọn. Lượt tính ở đầu hàm chạy lúc chưa biết khách
   * lấy gì, mà từ kỳ 2026-09 tiền mặt phụ thuộc đúng điều đó: khách chưa đủ tổ
   * hợp lấy Mì hoặc Nón thì mất 20k của VPa.
   *
   * Rổ không đổi giữa hai lượt tính — nó không đọc món đã chọn — nên phép kiểm
   * món hợp lệ ở trên vẫn đứng.
   */
  const granted = await giftForCustomer(customerId, item);

  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(giftGrants)
      .values({
        customerId,
        grantedBy: actor.id,
        cashTotal: granted.cashTotal,
        // MÃ món, không phải tên. Tên lúc phát vẫn còn trong `snapshot.basket` —
        // hai chỗ đọc dùng nó để hiện đúng chữ của thời điểm phát.
        chosenItem: item,
        // Đóng băng NGUYÊN kết quả: thể lệ đổi hay admin sửa tên món cũng không
        // được viết lại thứ đã phát cho khách (spec §5.3).
        snapshot: granted,
      })
      .onConflictDoNothing({ target: giftGrants.customerId })
      .returning({ id: giftGrants.id });
    if (rows.length === 0) return null;

    if (newIds.length > 0) {
      const linked = await tx
        .update(insuranceOrders)
        .set({ giftGrantId: rows[0].id })
        .where(
          and(
            inArray(insuranceOrders.id, newIds),
            eq(insuranceOrders.customerId, customerId),
            eq(insuranceOrders.source, "gift"),
            isNull(insuranceOrders.giftGrantId),
          ),
        )
        .returning({ id: insuranceOrders.id });
      // Nỗ lực song song đã nối một đơn khác thì throw để rollback cả lần chốt.
      if (linked.length !== newIds.length) throw new Error("Gift order was linked concurrently");
    }
    return rows[0];
  });

  if (!inserted)
    return {
      ok: false,
      code: GIFT_ERROR.ALREADY_GIVEN,
      message: "Khách này đã được tặng quà rồi — mỗi khách chỉ tặng đúng một lần",
    };

  /**
   * Phát quà ĐỔI ĐIỂM từ chốt 2026-08-24 (thể lệ mục 4c): khách CNKD chưa đủ tổ
   * hợp mà nhận Mì hoặc Nón thì điểm tụt từ 1,5 xuống 0,7.
   *
   * Tính lại theo THÁNG MỞ TÀI KHOẢN, không theo tháng bấm nút: điểm của khách
   * nằm ở tháng tài khoản mở (câu 7.13). Phát quà tháng 9 cho tài khoản mở
   * tháng 8 thì phải sửa điểm tháng 8, mà tháng đó có thể đã chốt lương.
   *
   * Một khách có tài khoản rải nhiều tháng thì mọi tháng đó đều phải tính lại —
   * chỉ tính tháng gần nhất là để lại điểm cũ ở các tháng trước.
   */
  for (const month of await accountMonthsOf(customerId))
    await recomputeKpiForCustomer(customerId, month);

  return {
    ok: true,
    customerName: customer.fullName,
    itemLabel: picked?.name ?? GIFT_DECLINED_LABEL,
  };
}

type ChangeOutcome =
  | { ok: true; grantId: string; customerName: string; fromLabel: string; toLabel: string }
  | { ok: false; message: string };

/** Đổi quà đã chốt, giữ lịch sử và dọn đúng các đơn bảo hiểm quà cũ. */
export async function changeGift(
  actor: User,
  customerId: string,
  form: GiftChangeForm,
): Promise<ChangeOutcome | null> {
  const [grant] = await db
    .select({ id: giftGrants.id, chosenItem: giftGrants.chosenItem, snapshot: giftGrants.snapshot, grantedAt: giftGrants.grantedAt, customerName: customers.fullName })
    .from(giftGrants)
    .innerJoin(customers, eq(customers.id, giftGrants.customerId))
    .where(eq(giftGrants.customerId, customerId))
    .limit(1);
  if (!grant) return null;

  /**
   * Đổi quà chỉ được làm TRONG NGÀY phát quà (chốt 2026-09-02). Qua ngày là
   * quà đã chốt: điểm KPI và tiền mặt của khách đã tính theo món đang giữ.
   */
  if (businessDay(grant.grantedAt) !== businessDay())
    return { ok: false, message: "Chỉ đổi quà được trong ngày phát quà." };

  const snapshot = GiftSimulateResult.safeParse(grant.snapshot);
  if (!snapshot.success) return { ok: false, message: "Danh sách quà ban đầu không hợp lệ, không thể đổi." };
  if (form.item === grant.chosenItem) return { ok: false, message: "Khách đang áp dụng món quà này rồi." };

  const next = form.item === GIFT_DECLINED ? null : snapshot.data.basket.find((b) => b.code === form.item);
  if (form.item !== GIFT_DECLINED && (!next || !next.id || next.status !== "ok"))
    return { ok: false, message: "Món quà mới phải thuộc danh sách quà ban đầu và còn cấp được." };

  const [insuranceItem] =
    form.item === GIFT_DECLINED
      ? []
      : await db.select({ id: insurancePackages.id }).from(insurancePackages).where(eq(insurancePackages.code, form.item)).limit(1);
  if (insuranceItem && form.newOrderIds.length === 0)
    return { ok: false, message: "Chọn quà bảo hiểm thì phải tạo đơn bảo hiểm mới trước." };

  const newIds = [...new Set(form.newOrderIds)];
  if (newIds.length > 0) {
    const newOrders = await db
      .select({ id: insuranceOrders.id, packageId: insuranceOrders.packageId })
      .from(insuranceOrders)
      .where(and(inArray(insuranceOrders.id, newIds), eq(insuranceOrders.customerId, customerId), eq(insuranceOrders.source, "gift"), eq(insuranceOrders.giftGrantId, grant.id)));
    if (newOrders.length !== newIds.length || newOrders.some((order) => order.packageId !== insuranceItem?.id))
      return { ok: false, message: "Có đơn bảo hiểm mới không thuộc lượt đổi quà này." };
  }

  /**
   * Số tiền đi theo món MỚI. Đổi từ Bảng mica sang Mì là mất 20k của VPa, đổi
   * ngược lại là lấy về — cột `cash_total` phải nói đúng số đang nợ khách.
   *
   * `snapshot` giữ nguyên: nó là rổ của lúc phát, không phải số tiền hiện tại.
   */
  const nextGift = await giftForCustomer(customerId, form.item);

  const changed = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(giftGrants)
      .set({ chosenItem: form.item, cashTotal: nextGift.cashTotal })
      .where(and(eq(giftGrants.id, grant.id), eq(giftGrants.chosenItem, grant.chosenItem)))
      .returning({ id: giftGrants.id });
    if (!updated) return false;

    const oldOrders = await tx
      .select({ id: insuranceOrders.id, status: insuranceOrders.status })
      .from(insuranceOrders)
      .where(and(eq(insuranceOrders.giftGrantId, grant.id), newIds.length ? notInArray(insuranceOrders.id, newIds) : undefined));
    // Giữ mọi đơn quà cũ để truy được lịch sử. Đơn đã huỷ từ lần đổi trước
    // giữ nguyên, các trạng thái còn lại đều được chuyển thành huỷ có lý do.
    const ordersToCancel = oldOrders.filter((o) => o.status !== "cancelled");
    if (ordersToCancel.length) {
      const ids = ordersToCancel.map((order) => order.id);
      await tx
        .update(insuranceOrders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(inArray(insuranceOrders.id, ids));
      await tx.insert(insuranceOrderStatusHistory).values(
        ordersToCancel.map((order) => ({
          orderId: order.id,
          fromStatus: order.status,
          toStatus: "cancelled" as const,
          changedBy: actor.id,
          note: "Khách đổi quà",
        })),
      );
    }
    await tx.insert(giftGrantChanges).values({ giftGrantId: grant.id, fromChosenItem: grant.chosenItem, toChosenItem: form.item, reason: form.reason, changedBy: actor.id });
    return true;
  });

  if (!changed) return { ok: false, message: "Quà vừa được người khác thay đổi. Tải lại rồi thử lại." };
  for (const month of await accountMonthsOf(customerId)) await recomputeKpiForCustomer(customerId, month);
  const label = (item: string) => item === GIFT_DECLINED ? GIFT_DECLINED_LABEL : snapshot.data.basket.find((b) => b.code === item)?.name ?? item;
  return { ok: true, grantId: grant.id, customerName: grant.customerName, fromLabel: label(grant.chosenItem), toLabel: label(form.item) };
}

/**
 * Tên HIỆN TẠI trong danh mục cho một loạt mã món — dùng cho con số GỘP.
 *
 * Khác `grantedItemLabel`: hàm này tra danh mục hôm nay, còn hàm kia đọc tên
 * đóng băng lúc phát. Một đợt quà đã giao phải giữ tên lúc giao (spec §5.3),
 * nhưng nhãn của một biểu đồ gộp nhiều đợt thì phải là tên đội đang dùng.
 */
export async function giftItemNames(codes: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(codes.filter((c) => c && c !== GIFT_DECLINED))];
  const map = new Map<string, string>();
  if (codes.includes(GIFT_DECLINED)) map.set(GIFT_DECLINED, GIFT_DECLINED_LABEL);
  if (wanted.length === 0) return map;

  const [packageRows, itemRows] = await Promise.all([
    db
      .select({ code: insurancePackages.code, name: insurancePackages.name })
      .from(insurancePackages)
      .where(inArray(insurancePackages.code, wanted)),
    db
      .select({ code: giftItems.code, name: giftItems.name })
      .from(giftItems)
      .where(inArray(giftItems.code, wanted)),
  ]);

  for (const row of [...packageRows, ...itemRows]) map.set(row.code, row.name);
  return map;
}

/**
 * Chữ hiện cho MỘT đợt đã phát — lấy TÊN LÚC PHÁT trong `snapshot.basket`.
 *
 * Không tra danh mục hiện tại: đợt đã phát phải đóng băng (spec §5.3), nên đổi
 * tên món hôm nay không được viết lại thứ đã giao cho khách hôm qua. Mã lạ
 * không có trong rổ đóng băng thì trả về chính mã đó, để màn không hiện ô trống.
 */
export function grantedItemLabel(chosenItem: string, snapshot: unknown): string {
  if (chosenItem === GIFT_DECLINED) return GIFT_DECLINED_LABEL;
  const basket = (snapshot as GiftSimulateResult | null)?.basket ?? [];
  return basket.find((b) => b.code === chosenItem)?.name ?? chosenItem;
}

/* ── P-44 · Danh sách quà đã phát ─────────────────────────────────────────── */

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export type GiftGrantFilters = {
  /** Tìm theo TÊN KHÁCH — không dấu, không phụ thuộc thứ tự từ. */
  search: string;
  /** Khoảng NGÀY PHÁT, YYYY-MM-DD. Rỗng = không giới hạn. */
  from: string;
  to: string;
  /** Phòng của người phát, đọc động từ `users` — xem `departmentUserIds`. */
  departmentId: string;
  staffId: string;
};

/**
 * Phạm vi bản ghi đi theo module `banking`: quà sinh ra từ combo tài khoản ngân
 * hàng, nên ai đọc được tài khoản của một phòng thì đọc được quà phòng đó phát.
 *
 * `gift_grants` KHÔNG chụp phòng của người phát, khác `insurance_orders` và
 * `bank_accounts`. Nên phạm vi phòng phải đổi thành danh sách người TRƯỚC khi
 * lọc — cùng lối với `bankIdsOf` ở `server/banking.ts`.
 *
 * ⚠️ Hệ quả: người phát chuyển phòng thì đợt quà cũ của họ đi theo phòng MỚI.
 * Muốn lịch sử đứng yên thì phải chụp phòng vào một cột riêng, cần migration.
 */
async function departmentUserIds(departmentIds: string[]): Promise<string[]> {
  if (departmentIds.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.departmentId, departmentIds));
  return rows.map((r) => r.id);
}

async function giftGrantWhere(actor: User, query: GiftGrantFilters): Promise<SQL | undefined> {
  const visible = recordVisibility(actor, "banking", "view-detail");

  let scope: SQL | undefined;
  if (visible.kind === "departments") {
    const ids = await departmentUserIds(visible.departmentIds);
    // `[]` = phạm vi không có ai → không dòng nào khớp. Bỏ qua điều kiện là mở
    // cả kho cho đúng người đáng hẹp nhất.
    scope = ids.length > 0 ? inArray(giftGrants.grantedBy, ids) : sql`false`;
  } else if (visible.kind === "creator") {
    scope = eq(giftGrants.grantedBy, visible.userId);
  } else if (visible.kind !== "all") {
    scope = sql`false`;
  }

  // Ô lọc phòng nối bằng VÀ với phạm vi, không thay nó: chọn phòng ngoài phạm vi
  // cho ra bảng rỗng chứ không nới phạm vi.
  let departmentPick: SQL | undefined;
  if (query.departmentId) {
    const ids = await departmentUserIds([query.departmentId]);
    departmentPick = ids.length > 0 ? inArray(giftGrants.grantedBy, ids) : sql`false`;
  }

  const search = query.search.trim();
  const searchWhere =
    search.length > 0
      ? and(
          ...search.split(/\s+/).map(
            (term) =>
              sql`exists (
                select 1 from ${customers} c
                where c.id = ${giftGrants.customerId}
                  and c.search_name like '%' || mgst_normalize(${likeEscape(term)}) || '%' escape '\\'
              )`,
          ),
        )
      : undefined;

  const parts = [
    scope,
    searchWhere,
    departmentPick,
    // Ngày sai định dạng thì bỏ qua, không trả 400 — link cũ hay ô địa chỉ gõ
    // nhầm không đáng làm hỏng cả màn.
    isRealIsoDate(query.from)
      ? sql`(${giftGrants.grantedAt} at time zone ${BUSINESS_TIMEZONE})::date >= ${query.from}::date`
      : undefined,
    isRealIsoDate(query.to)
      ? sql`(${giftGrants.grantedAt} at time zone ${BUSINESS_TIMEZONE})::date <= ${query.to}::date`
      : undefined,
    query.staffId ? eq(giftGrants.grantedBy, query.staffId) : undefined,
  ].filter(Boolean) as SQL[];

  return parts.length > 0 ? and(...parts) : undefined;
}

const giftGrantRows = (where: SQL | undefined) =>
  db
    .select({
      id: giftGrants.id,
      customerId: giftGrants.customerId,
      customerName: customers.fullName,
      grantedAt: giftGrants.grantedAt,
      cashTotal: giftGrants.cashTotal,
      chosenItem: giftGrants.chosenItem,
      snapshot: giftGrants.snapshot,
      grantedByName: users.fullName,
      grantedByStaffCode: sql<string>`coalesce(${users.staffCode}, '')`,
      grantedByDepartmentName: departments.name,
    })
    .from(giftGrants)
    .innerJoin(customers, eq(customers.id, giftGrants.customerId))
    // leftJoin: người phát có thể đã bị xoá khỏi hệ thống, và ban giám đốc không
    // thuộc phòng nào. innerJoin thì những dòng đó biến mất mà không báo gì.
    .leftJoin(users, eq(users.id, giftGrants.grantedBy))
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(where);

type GiftGrantQueryRow = Awaited<ReturnType<typeof giftGrantRows>>[number];

const toGiftGrantRow = (r: GiftGrantQueryRow): GiftGrantRow => ({
  id: r.id,
  customerId: r.customerId,
  customerName: r.customerName,
  date: businessDay(r.grantedAt),
  cashTotal: r.cashTotal,
  // Tên LÚC PHÁT trong rổ đóng băng, không tra danh mục hiện tại (spec §5.3).
  item: grantedItemLabel(r.chosenItem, r.snapshot),
  declined: r.chosenItem === GIFT_DECLINED,
  grantedByName: r.grantedByName,
  grantedByStaffCode: r.grantedByStaffCode,
  grantedByDepartmentName: r.grantedByDepartmentName,
});

/** MỘT trang quà đã phát, đã lọc/tìm/sắp sẵn ở máy chủ (AGENTS.md §5.1). */
export async function listGiftGrants(
  actor: User,
  query: GiftGrantFilters,
  page: PageArgs<"date">,
): Promise<Page<GiftGrantRow>> {
  const where = await giftGrantWhere(actor, query);
  const order =
    page.dir === "asc"
      ? [asc(giftGrants.grantedAt), asc(giftGrants.id)]
      : [desc(giftGrants.grantedAt), desc(giftGrants.id)];

  const [rows, [totals]] = await Promise.all([
    giftGrantRows(where).orderBy(...order).limit(page.limit).offset(page.offset),
    db.select({ value: count() }).from(giftGrants).where(where),
  ]);

  return { rows: rows.map(toGiftGrantRow), total: totals?.value ?? 0 };
}

/**
 * TRỌN danh sách khớp bộ lọc, CHỈ cho việc xuất Excel — đường riêng chứ không
 * mở tham số "lấy hết" trên route đã phân trang (AGENTS.md §5.1, điều 4).
 *
 * `total` có thể lớn hơn `rows.length` khi chạm trần; nơi gọi BẮT BUỘC so hai
 * số rồi dừng, vì file thiếu dòng trông y hệt file đủ.
 */
export async function listGiftGrantsForExport(
  actor: User,
  query: GiftGrantFilters,
): Promise<Page<GiftGrantRow>> {
  const where = await giftGrantWhere(actor, query);

  const [rows, [totals]] = await Promise.all([
    giftGrantRows(where)
      .orderBy(desc(giftGrants.grantedAt), desc(giftGrants.id))
      .limit(GIFT_EXPORT_LIMIT),
    db.select({ value: count() }).from(giftGrants).where(where),
  ]);

  return { rows: rows.map(toGiftGrantRow), total: totals?.value ?? 0 };
}
