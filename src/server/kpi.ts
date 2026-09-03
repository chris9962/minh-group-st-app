import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { monthRange } from "@/lib/format";
import { bankingPointsFor, kpiAppliesTo, type ScoringAccount } from "@/rules";
import type { Range } from "./org";
import { db } from "./db/client";
import {
  bankAccounts,
  banks,
  customers,
  departments,
  giftGrants,
  kpiScores,
  services,
  serviceTypes,
  users,
} from "./db/schema";

/**
 * Tính lại điểm KPI và ghi vào `kpi_scores`.
 *
 * Điểm được LƯU chứ không tính lúc truy vấn — xem ghi chú ở bảng `kpiScores`
 * trong `db/schema.ts` để biết vì sao đây là ngoại lệ có chủ ý so với
 * `mgst-db-design.md` §9.
 *
 * ⚠️ MỌI ĐƯỜNG GHI ĐỔI DỮ LIỆU TÍNH ĐIỂM ĐỀU PHẢI GỌI HÀM NÀY. Sót một nhánh
 * nghĩa là điểm đứng im trong khi dữ liệu đã đổi, không báo gì. Mà điểm KPI
 * dính tới lương.
 *
 * Đã nối: chuyển tài khoản sang `done` (`server/banking.ts`), ghi/sửa/xoá dịch
 * vụ (`server/services.ts`), sửa hệ số một loại dịch vụ (`server/catalog.ts`,
 * gọi `recomputeKpiForMonth`). Bản `creating` không vào điểm nên tạo và xoá
 * nháp không cần tính lại.
 *
 * Sửa một tài khoản đã `done` (chốt 07/08) đi qua `updateFinishedAccount`, và
 * nhánh đó tính lại điểm cho CẢ tháng cũ lẫn tháng mới khi ngày mở đổi — chỉ
 * tính tháng mới thì lượt đó được đếm hai lần.
 *
 * ⚠️ MỌI DÒNG `kpi_scores` GHI TRƯỚC 07/08 ĐỀU SAI và không tự sửa: chúng mang
 * điểm của công thức cũ, và cột `banking_points` lúc đó luôn là 0. Dòng cũ chỉ
 * được tính lại khi có người ghi tài khoản mới cho đúng khách đó. Chạy tay một
 * lần cho từng tháng đã có dữ liệu:
 *
 *     bun run kpi:recompute 2026-08
 */

/**
 * Kết nối chạy câu lệnh: `db` thường, hoặc `tx` khi đang trong transaction.
 *
 * Hai hàm đọc dưới đây PHẢI chạy trên cùng kết nối với câu ghi. Đọc ở kết nối
 * khác thì khoá của `recomputeKpi` không phủ được lượt đọc đó.
 */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Điểm dịch vụ giữ cách cũ: Σ hệ số loại dịch vụ (spec §7.2), vẫn tính được bằng SQL. */
async function servicePointsOf(conn: Db, userId: string, from: string, to: string): Promise<number> {
  const [row] = await conn
    .select({ points: sql<number>`coalesce(sum(${serviceTypes.coefficient}), 0)::float` })
    .from(services)
    .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
    .where(
      and(
        eq(services.createdBy, userId),
        gte(services.serviceDate, from),
        lte(services.serviceDate, to),
      ),
    );
  return row?.points ?? 0;
}

/**
 * Tài khoản đã tính điểm của một người trong tháng, nắn về dạng hàm luật cần.
 *
 * Chỉ lấy `done`: tài khoản đang tạo chưa phải là tài khoản thật. Kéo TỪNG DÒNG
 * chứ không `SUM` — luật mới gom theo khách rồi mới ra điểm, mà một con số tổng
 * thì vứt mất thông tin khách nào có tài khoản nào.
 *
 * ⚠️ Lọc theo `customers.created_by`, KHÔNG phải `bank_accounts.created_by`
 * (chốt 07/08, câu 7.11): điểm combo thuộc về người lập hồ sơ khách, vì thể lệ
 * xét theo KHÁCH. Mở hộ tài khoản cho khách của đồng nghiệp thì điểm về đồng
 * nghiệp. Đổi lại chỗ này là đổi lương của người khác — đừng "dọn cho gọn".
 */
async function scoringAccountsOf(
  conn: Db,
  userId: string,
  from: string,
  to: string,
): Promise<ScoringAccount[]> {
  const rows = await conn
    .select({
      customerId: bankAccounts.customerId,
      bankCode: banks.code,
      appInstalled: bankAccounts.appInstalled,
      openedDate: bankAccounts.openedDate,
      // Ô chọn "Mở tài khoản CNKD / HKD" nằm trên chính dòng VPa. Từ chốt
      // 2026-08-24 nó RA ĐIỂM (thể lệ mục 4c), không còn chỉ mở nhóm quà.
      accountType: bankAccounts.accountType,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(
      and(
        eq(customers.createdBy, userId),
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, from),
        lte(bankAccounts.openedDate, to),
      ),
    );

  return rows.map((r) => ({
    customerId: r.customerId,
    bankCode: r.bankCode,
    appInstalled: r.appInstalled,
    openedDate: r.openedDate ?? "",
    household: r.accountType,
  }));
}

/**
 * Món quà từng khách ĐÃ nhận, trong đúng nhóm khách đang tính điểm.
 *
 * Vào của phép tính điểm từ chốt 2026-08-24 (thể lệ mục 4c): phát Mì hay Nón
 * cho khách CNKD một tài khoản kéo điểm khách đó từ 1,5 xuống 0,7.
 *
 * Đọc `chosen_item` chứ không đọc `snapshot`: `snapshot` là rổ lúc chốt, còn
 * cột này là món khách THẬT SỰ lấy. Khách từ chối thì `chosen_item` mang mã từ
 * chối, không nằm trong danh sách hạ mức điểm nên không ảnh hưởng.
 */
async function grantedGiftsOf(conn: Db, userId: string): Promise<Map<string, string | null>> {
  const rows = await conn
    .select({ customerId: giftGrants.customerId, chosenItem: giftGrants.chosenItem })
    .from(giftGrants)
    .innerJoin(customers, eq(customers.id, giftGrants.customerId))
    .where(eq(customers.createdBy, userId));

  return new Map(rows.map((r) => [r.customerId, r.chosenItem]));
}

/**
 * Điểm combo ngân hàng của TỪNG khách trong danh sách, cho ĐÚNG trang đang hiện.
 *
 * Bước "dán phần phụ sau" của cách A ở AGENTS.md §5.2: câu chính đã cắt trang,
 * hàm này chỉ chạy trên 15 id đó. Truyền cả danh sách khách của một tháng vào
 * đây là quay lại hình dạng câu hỏi mà §5.2 cấm.
 *
 * `yearMonth` BẮT BUỘC, và nơi gọi chỉ có nó khi người xem đã chọn khoảng ngày
 * (chốt 2026-09-04). Không có khoảng ngày thì không có tháng, không có tháng
 * thì không có file luật — màn để trống ô điểm chứ không đoán một tháng nào đó.
 *
 * Chỉ tính tài khoản MỞ trong tháng ấy: tổ hợp không nối qua tháng (thể lệ câu
 * 7.13). Mốc là `opened_date`, không phải ngày lập hồ sơ khách.
 *
 * `giftGrants` phải đi kèm: kỳ 2026-08 hạ điểm CNKD của khách đã nhận Mì hoặc
 * Nón. Bỏ nó thì điểm của tháng đó cao hơn điểm thật.
 */
export async function bankingPointsByCustomer(
  customerIds: string[],
  yearMonth: string,
): Promise<Map<string, number>> {
  const points = new Map<string, number>();
  if (customerIds.length === 0) return points;

  const { from, to } = monthRange(yearMonth);
  const rows = await db
    .select({
      customerId: bankAccounts.customerId,
      bankCode: banks.code,
      appInstalled: bankAccounts.appInstalled,
      openedDate: bankAccounts.openedDate,
      household: bankAccounts.accountType,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(
      and(
        inArray(bankAccounts.customerId, customerIds),
        eq(bankAccounts.status, "done"),
        gte(bankAccounts.openedDate, from),
        lte(bankAccounts.openedDate, to),
      ),
    );

  const granted = new Map(
    (
      await db
        .select({ customerId: giftGrants.customerId, chosenItem: giftGrants.chosenItem })
        .from(giftGrants)
        .where(inArray(giftGrants.customerId, customerIds))
    ).map((g) => [g.customerId, g.chosenItem]),
  );

  const byCustomer = new Map<string, ScoringAccount[]>();
  for (const r of rows) {
    const account: ScoringAccount = {
      customerId: r.customerId,
      bankCode: r.bankCode,
      appInstalled: r.appInstalled,
      openedDate: r.openedDate ?? "",
      household: r.household,
    };
    const kept = byCustomer.get(r.customerId);
    if (kept) kept.push(account);
    else byCustomer.set(r.customerId, [account]);
  }

  for (const [customerId, accounts] of byCustomer) {
    points.set(customerId, bankingPointsFor(accounts, yearMonth, granted));
  }
  return points;
}

/**
 * Loại phòng của một người — `null` khi họ không thuộc phòng nào (Ban giám đốc,
 * tài khoản quản trị).
 *
 * `leftJoin` chứ không `innerJoin`: `innerJoin` bỏ luôn dòng của người không có
 * phòng, và hàm trả `null` cho cả họ lẫn người có phòng nhưng phòng đã xoá —
 * hai chuyện khác nhau nhưng cùng dẫn tới "chưa có công thức", nên không cần
 * tách.
 */
async function departmentTypeOf(conn: Db, userId: string) {
  const [row] = await conn
    .select({ type: departments.type })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(users.id, userId));
  return row?.type ?? null;
}

/**
 * Tính lại điểm của MỘT người trong MỘT tháng.
 *
 * ⚠️ Đọc — tính — ghi phải nằm trong CÙNG một transaction, và phải xin khoá
 * trước khi đọc. Bản cũ đọc rồi ghi ngoài mọi khoá, nên hai lượt chạy gần nhau
 * làm mất cập nhật: A đọc, B ghi xong, A ghi đè bằng con số đã cũ. Đo trên máy
 * dev cửa sổ đó là 2–3 ms. `onConflictDoUpdate` không cứu được — nó chỉ nguyên
 * tử ở câu ghi, không nguyên tử với lượt đọc đứng trước.
 *
 * Sai kiểu này không báo gì, nằm lại tới khi có người đụng lại khách đó, và
 * điểm KPI dính tới lương.
 */
export async function recomputeKpi(userId: string, yearMonth: string): Promise<void> {
  await db.transaction((tx) => recomputeKpiOn(tx, userId, yearMonth));
}

/**
 * Thân của `recomputeKpi`, chạy trên một transaction CÓ SẴN.
 *
 * Tách ra để `recomputeKpiForMonth` bọc cả vòng lặp trong MỘT transaction. Gọi
 * `db.transaction` lồng nhau thì Postgres dựng savepoint, và lượt tính cho
 * người thứ 200 hỏng vẫn để 199 người trước ghi xong — đúng trạng thái nửa vời
 * mà transaction bao ngoài sinh ra để chặn.
 */
async function recomputeKpiOn(tx: Db, userId: string, yearMonth: string): Promise<void> {
  const { from, to } = monthRange(yearMonth);

  /**
   * Khoá theo ĐÚNG ô điểm đang ghi, không khoá bảng: hai lượt cho cùng
   * (người, tháng) xếp hàng, hai người khác nhau vẫn chạy song song. Postgres
   * nhả khoá khi transaction kết thúc, kể cả khi có lỗi ném ra.
   *
   * Mỗi lượt gọi lấy đúng MỘT khoá, và `recomputeKpiForMonth` duyệt người theo
   * thứ tự `id` cố định — hai lượt chạy song song xin khoá cùng thứ tự nên
   * không có deadlock.
   */
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${yearMonth}))`,
  );

  /**
   * Phòng chưa có công thức thì XOÁ dòng điểm, không ghi 0 (spec §7.0).
   *
   * Còn dòng nghĩa là "đã chấm theo công thức của kỳ". Ghi 0 cho người phòng
   * `office` là nói họ làm mà không được điểm nào, trong khi thật ra chưa ai
   * viết công thức cho công của họ.
   *
   * ⚠️ Người chuyển từ phòng kinh doanh sang phòng `office` mất điểm của MỌI
   * tháng có lượt tính lại chạm tới, kể cả tháng đã trả lương. Câu 4 của spec
   * §7.0 — tính theo phòng lúc ghi bản ghi hay phòng cuối tháng — vẫn chờ đội
   * KD trả lời; code đang lấy phòng HIỆN TẠI.
   */
  if (!kpiAppliesTo(await departmentTypeOf(tx, userId))) {
    await tx
      .delete(kpiScores)
      .where(and(eq(kpiScores.userId, userId), eq(kpiScores.yearMonth, yearMonth)));
    return;
  }

  // Nối tiếp chứ không `Promise.all`: một transaction đi trên một kết nối,
  // gửi hai câu cùng lúc lên đó là lỗi giao thức.
  const accounts = await scoringAccountsOf(tx, userId, from, to);
  const granted = await grantedGiftsOf(tx, userId);
  const service = await servicePointsOf(tx, userId, from, to);
  const banking = bankingPointsFor(accounts, yearMonth, granted);

  await tx
    .insert(kpiScores)
    .values({
      userId,
      yearMonth,
      bankingPoints: String(banking),
      servicePoints: String(service),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [kpiScores.userId, kpiScores.yearMonth],
      set: {
        bankingPoints: String(banking),
        servicePoints: String(service),
        updatedAt: new Date(),
      },
    });
}

/**
 * Tính lại điểm cho CHỦ HỒ SƠ của một khách.
 *
 * Đường ghi tài khoản ngân hàng phải gọi hàm này chứ không gọi thẳng
 * `recomputeKpi(người bấm)`: từ 07/08 điểm combo về người lập hồ sơ khách (câu
 * 7.11). Nhân viên A hoàn thành tài khoản cho khách của B mà tính lại cho A thì
 * A không đổi gì còn điểm của B đứng im — sai lặng lẽ.
 *
 * Khách không có người lập (dữ liệu nhập hàng loạt cũ) thì không ai nhận điểm.
 */
export async function recomputeKpiForCustomer(
  customerId: string,
  yearMonth: string,
): Promise<void> {
  const [row] = await db
    .select({ ownerId: customers.createdBy })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (row?.ownerId) await recomputeKpi(row.ownerId, yearMonth);
}

/**
 * Tính lại cho TOÀN CÔNG TY một tháng.
 *
 * Dùng khi thứ đổi không thuộc về một người: sửa hệ số một loại dịch vụ, hoặc
 * lần đầu có file luật của kỳ. Chạy tuần tự chứ không song song — vài trăm
 * người, và đây không phải đường đi của người dùng nên chậm cũng được; bắn song
 * song thì cạn sạch pool 10 kết nối và làm nghẽn các request đang phục vụ.
 */
export async function recomputeKpiForMonth(yearMonth: string): Promise<number> {
  /**
   * MỘT transaction cho cả vòng lặp: hoặc cả công ty chấm theo hệ số mới, hoặc
   * không ai đổi.
   *
   * Bản cũ mở một transaction cho mỗi người. Timeout hay lỗi giữa chừng để lại
   * nửa công ty theo hệ số mới, nửa theo hệ số cũ — không báo gì, không có lượt
   * chạy lại, và admin không có cách nào biết dữ liệu đang ở trạng thái nào.
   *
   * Sắp theo `id` để hai lượt chạy song song xin khoá cùng thứ tự, tức không có
   * deadlock. Vẫn tuần tự chứ không song song: bắn song song thì cạn pool 10
   * kết nối và làm nghẽn các request đang phục vụ.
   */
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.id));
    for (const row of rows) await recomputeKpiOn(tx, row.id, yearMonth);
    return rows.length;
  });
}

/* ── Điểm theo KHOẢNG NGÀY — cho màn Tổng quan ─────────────────────────── */

/**
 * Điểm của từng người trong một KHOẢNG NGÀY tuỳ ý, gom theo người.
 *
 * `kpi_scores` chỉ lưu theo THÁNG, nên màn Tổng quan không đọc bảng đó được khi
 * người dùng chọn "hôm nay" hay một khoảng tự đặt. Hàm này tính lại từ dữ liệu
 * gốc, đúng công thức của `recomputeKpiOn`, chỉ khác ở chỗ nhận `from`/`to`.
 *
 * ⚠️ KHÔNG ghi vào `kpi_scores`. Bảng đó vẫn là số chốt theo tháng, dùng cho
 * lương. Con số ở đây để XEM theo kỳ, và hai số trùng nhau khi kỳ xem đúng bằng
 * một tháng.
 *
 * Khoảng vắt hai tháng thì tách ra tính theo TỪNG THÁNG rồi cộng: mỗi tháng một
 * file luật, và tổ hợp không nối qua tháng (thể lệ câu 7.13).
 *
 * Chỉ tính người thuộc phòng loại `sales` — cùng điều kiện `kpiAppliesTo` mà
 * `recomputeKpiOn` dùng. Người phòng khác chưa có công thức, không phải được 0.
 */
export async function pointsByStaffInRange(
  range: Range,
): Promise<Map<string, { departmentId: string | null; points: number }>> {
  const [accountRows, serviceRows, grantRows] = await Promise.all([
    db
      .select({
        userId: customers.createdBy,
        departmentId: users.departmentId,
        customerId: bankAccounts.customerId,
        bankCode: banks.code,
        appInstalled: bankAccounts.appInstalled,
        openedDate: bankAccounts.openedDate,
        accountType: bankAccounts.accountType,
      })
      .from(bankAccounts)
      .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
      .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
      .innerJoin(users, eq(users.id, customers.createdBy))
      .innerJoin(departments, eq(departments.id, users.departmentId))
      .where(
        and(
          eq(departments.type, "sales"),
          eq(bankAccounts.status, "done"),
          gte(bankAccounts.openedDate, range.from),
          lte(bankAccounts.openedDate, range.to),
        ),
      ),
    db
      .select({
        userId: services.createdBy,
        departmentId: users.departmentId,
        points: sql<number>`coalesce(sum(${serviceTypes.coefficient}), 0)::float`,
      })
      .from(services)
      .innerJoin(serviceTypes, eq(serviceTypes.id, services.serviceTypeId))
      .innerJoin(users, eq(users.id, services.createdBy))
      .innerJoin(departments, eq(departments.id, users.departmentId))
      .where(
        and(
          eq(departments.type, "sales"),
          gte(services.serviceDate, range.from),
          lte(services.serviceDate, range.to),
        ),
      )
      .groupBy(services.createdBy, users.departmentId),
    // Món khách đã nhận — vào của phép tính điểm ở kỳ 2026-08. Kéo trọn bảng
    // vì nó nhỏ, và lọc theo khách thì phải biết trước danh sách khách.
    db.select({ customerId: giftGrants.customerId, chosenItem: giftGrants.chosenItem }).from(giftGrants),
  ]);

  const granted = new Map(grantRows.map((r) => [r.customerId, r.chosenItem]));

  /** Tài khoản gom theo người rồi theo tháng — mỗi tháng một file luật. */
  const byStaff = new Map<string, { departmentId: string | null; months: Map<string, ScoringAccount[]> }>();
  for (const r of accountRows) {
    if (!r.userId) continue;
    const month = (r.openedDate ?? "").slice(0, 7);
    if (!month) continue;

    let staff = byStaff.get(r.userId);
    if (!staff) {
      staff = { departmentId: r.departmentId, months: new Map() };
      byStaff.set(r.userId, staff);
    }
    const rows = staff.months.get(month);
    const account: ScoringAccount = {
      customerId: r.customerId,
      bankCode: r.bankCode,
      appInstalled: r.appInstalled,
      openedDate: r.openedDate ?? "",
      household: r.accountType,
    };
    if (rows) rows.push(account);
    else staff.months.set(month, [account]);
  }

  const out = new Map<string, { departmentId: string | null; points: number }>();
  const add = (userId: string, departmentId: string | null, points: number) => {
    const cur = out.get(userId);
    if (cur) cur.points = Math.round((cur.points + points) * 10) / 10;
    else out.set(userId, { departmentId, points: Math.round(points * 10) / 10 });
  };

  for (const [userId, staff] of byStaff)
    for (const [month, accounts] of staff.months)
      add(userId, staff.departmentId, bankingPointsFor(accounts, month, granted));

  for (const r of serviceRows) if (r.userId) add(r.userId, r.departmentId, r.points);

  return out;
}

/** Cùng con số, cuộn lên PHÒNG của người lập hồ sơ. */
export async function pointsByDepartmentInRange(range: Range): Promise<Map<string, number>> {
  const byStaff = await pointsByStaffInRange(range);
  const out = new Map<string, number>();
  for (const { departmentId, points } of byStaff.values()) {
    if (!departmentId) continue;
    out.set(departmentId, Math.round(((out.get(departmentId) ?? 0) + points) * 10) / 10);
  }
  return out;
}
