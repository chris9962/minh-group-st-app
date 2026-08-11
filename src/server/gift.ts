import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { GIFT_DECLINED, GIFT_ERROR } from "@/lib/api/customers";
import { EMPTY_GIFT, type GiftSimulateInput, type GiftSimulateResult } from "@/lib/api/settings";
import { businessDay } from "@/lib/format";
import type { User } from "@/lib/types";
import { giftFor, type GiftInput, type GiftResult } from "@/rules";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  channels,
  customers,
  departments,
  giftGrants,
  giftItems,
  insurancePackages,
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
 *   không phải phòng của người bấm nút xem, và đọc từ cột SNAPSHOT
 *   `customers.created_by_department_id` chứ không tra sống sang `users`: người
 *   lập hồ sơ chuyển phòng không được viết lại rổ quà của khách cũ (#8).
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
      household: r.accountType !== "none",
    })),
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
      };
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      source: item.reason,
      status: row.active ? ("ok" as const) : ("discontinued" as const),
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
): Promise<GiftSimulateResult> {
  const result = giftFor(input, at);
  // Kỳ chưa có file luật: trả rổ rỗng KÈM một câu nói rõ vì sao. Rỗng mà im
  // lặng thì màn hiện "Chưa đủ điều kiện" cho một khách có thể đang đủ.
  if (!result)
    return { ...EMPTY_GIFT, explain: [`Ngày ${at} chưa có thể lệ nào trong hệ thống.`] };

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
    explain: result.explain,
  };
}

/** Hai danh sách mã quà giống nhau không — thứ tự luật sinh ra ổn định nên so thẳng. */
const sameCodes = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((code, i) => code === b[i]);

/** P-42 và P-43 — quà của một khách có thật trong database. */
export const giftForCustomer = async (customerId: string): Promise<GiftSimulateResult> =>
  giftResultOf(await giftInputFor(customerId));

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
  giftResultOf({
    accounts: input.accounts.map((a) => ({
      customerId: "simulate",
      bankCode: a.bankCode,
      appInstalled: a.appInstalled,
      openedDate: businessDay(),
      // Màn thử P-81 chưa có ô chọn CNKD/HKD — người dùng khai bằng cách thêm
      // một dòng ngân hàng mã `CNKD`.
      household: false,
    })),
    channelCodes: input.channelCodes,
    departmentCode: input.departmentCode,
  });

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
        household: row.accountType !== "none",
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
  | { ok: true; customerName: string }
  | { ok: false; code: (typeof GIFT_ERROR)[keyof typeof GIFT_ERROR]; message: string };

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

  const picked = declined ? null : gift.basket.find((b) => b.name === item);

  if (!declined && !picked)
    return {
      ok: false,
      code: GIFT_ERROR.NOT_IN_BASKET,
      message: `"${item}" không nằm trong rổ quà của khách này`,
    };

  // Rổ giữ lại cả món đã ngừng để màn nói được lý do, nên chốt chặn phải tự
  // kiểm — ẩn nút ở giao diện không phải là chặn (AGENTS.md §6).
  if (picked && picked.status !== "ok")
    return {
      ok: false,
      code: GIFT_ERROR.ITEM_DISCONTINUED,
      message:
        picked.status === "discontinued"
          ? `"${item}" đã ngừng cấp — chọn món khác trong rổ`
          : `"${item}" không còn trong danh mục quà — báo quản trị thêm lại rồi phát`,
    };

  const inserted = await db
    .insert(giftGrants)
    .values({
      customerId,
      grantedBy: actor.id,
      cashTotal: gift.cashTotal,
      chosenItem: item,
      // Đóng băng NGUYÊN kết quả: thể lệ đổi hay admin sửa tên món cũng không
      // được viết lại thứ đã phát cho khách (spec §5.3).
      snapshot: gift,
    })
    .onConflictDoNothing({ target: giftGrants.customerId })
    .returning({ id: giftGrants.id });

  if (inserted.length === 0)
    return {
      ok: false,
      code: GIFT_ERROR.ALREADY_GIVEN,
      message: "Khách này đã được tặng quà rồi — mỗi khách chỉ tặng đúng một lần",
    };

  return { ok: true, customerName: customer.fullName };
}
