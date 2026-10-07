import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { businessMonth, monthRange, roundPoints } from "@/lib/format";
import { centsFromDecimal } from "@/lib/money";
import { shiftMonth } from "@/lib/period";
import type { SocialInsuranceKind, SocialInsurancePlan } from "@/lib/api/socialInsurance";
import {
  bankingPointsFor,
  kpiAppliesTo,
  multiBankComboCountFor,
  type ScoringAccount,
} from "@/rules";
import type { Range } from "./org";
import { isMonthClosed } from "./closedMonths";
import { customerDayBetween, customerDayText } from "./customerDay";
import { db } from "./db/client";
import { recomputeEmployeeWorkDay, recomputeWorkDayForCustomer } from "./workDays";
import {
  bankAccounts,
  banks,
  customers,
  departments,
  giftGrants,
  kpiScores,
  staffRoster,
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
 * gọi `recomputeKpiForMonth`), ghi/sửa/xoá dòng BHYT/BHXH và lưu mức điểm An
 * Sinh (`server/socialInsurance*.ts`). Bản `creating` không vào điểm nên tạo và
 * xoá nháp không cần tính lại.
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

/**
 * Các lượt dịch vụ ĐƯỢC TÍNH ĐIỂM trong khoảng ngày, dạng câu con có các cột
 * `id`, `created_by`, `department_id` (phòng của người làm trong tháng của
 * lượt đó), `service_type_id`, `coefficient`.
 *
 * Luật của thông báo lương 2026-09-30 (chốt với chủ dự án cùng ngày):
 * - Chỉ người có cách tính lương `atm` TRONG tháng của lượt dịch vụ được điểm
 *   (đọc `staff_roster`). Người khác 0 điểm.
 * - Hệ số và trần đọc ở `service_type_months` của tháng có lượt dịch vụ (dòng
 *   gần nhất không sau tháng đó). Loại chưa có dòng nào thì không có điểm.
 * - Mỗi loại có trần số lượt theo ngày và theo tháng của từng người. Lượt vượt
 *   trần ngày lấy `over_cap_coefficient` (Chi BTXH: từ lượt thứ 11 là 0,05, chốt
 *   2026-10-01); lượt vượt trần tháng không có điểm. Lượt ghi trước được tính trước.
 *
 * Trần tháng xếp hạng trên TRỌN tháng rồi mới cắt về khoảng đang hỏi. Xếp hạng
 * trong riêng khoảng thì hai nửa tháng cộng lại ra nhiều hơn cả tháng.
 *
 * Mọi nơi hiện điểm dịch vụ đọc câu con này. Tính ở hai nơi là điểm lưu cho
 * lương và điểm trên màn lệch nhau.
 */
const countedServices = (from: string, to: string, userId?: string) => sql`(
  select k.id, k.created_by, k.department_id, k.service_type_id, k.points as coefficient
  from (
    select d.*,
           case when d.daily_cap is null or d.day_rank <= d.daily_cap
                then d.coefficient else d.over_cap_coefficient end as points,
           row_number() over (
             partition by d.created_by, d.service_type_id, date_trunc('month', d.service_date)
             order by d.service_date, d.created_at, d.id
           ) as month_rank
    from (
      select s.id, s.created_by, r.department_id, s.service_type_id, s.service_date,
             s.created_at, t.coefficient, t.daily_cap, t.over_cap_coefficient, t.monthly_cap,
             row_number() over (
               partition by s.created_by, s.service_type_id, s.service_date
               order by s.created_at, s.id
             ) as day_rank
      from services s
      join lateral (
        select w.coefficient, w.daily_cap, w.over_cap_coefficient, w.monthly_cap
        from service_type_months w
        where w.service_type_id = s.service_type_id
          and w.year_month <= to_char(s.service_date, 'YYYY-MM')
        order by w.year_month desc
        limit 1
      ) t on true
      join staff_roster r
        on r.user_id = s.created_by and r.year_month = to_char(s.service_date, 'YYYY-MM')
      where r.salary_scheme = 'atm'
        and s.service_date >= date_trunc('month', ${from}::date)::date
        and s.service_date < (date_trunc('month', ${to}::date) + interval '1 month')::date
        ${userId ? sql`and s.created_by = ${userId}` : sql``}
    ) d
    where d.daily_cap is null or d.day_rank <= d.daily_cap or d.over_cap_coefficient > 0
  ) k
  where (k.monthly_cap is null or k.month_rank <= k.monthly_cap)
    and k.service_date between ${from}::date and ${to}::date
)`;

async function servicePointsOf(conn: Db, userId: string, from: string, to: string): Promise<number> {
  const result = await conn.execute<{ points: number }>(
    sql`select coalesce(sum(c.coefficient), 0)::float as points from ${countedServices(from, to, userId)} c`,
  );
  return result.rows[0]?.points ?? 0;
}

/**
 * Điểm An Sinh theo người tải file, tháng biên lai, loại và phương án, dạng câu
 * con có các cột `uploaded_by`, `receipt_month`, `kind`, `plan`, `collected`,
 * `revenue_per_point`, `points`.
 *
 * Mỗi nhóm lấy tổng tiền thu chia mức điểm của nhóm đó, làm tròn 2 số lẻ ngay ở
 * nhóm: các dòng diễn giải theo nhóm phải cộng ra đúng điểm tháng. Bộ mức điểm là
 * bộ của tháng gần nhất không sau tháng biên lai, cùng luật với % hoa hồng. Nhóm
 * thiếu mức điểm thì không có điểm.
 */
const socialInsuranceGroupPoints = (fromMonth: string, toMonth: string, where?: SQL) => sql`(
  select g.uploaded_by, g.receipt_month, g.kind, g.plan, g.collected, k.revenue_per_point,
         round(g.collected / k.revenue_per_point, 2) as points
  from (
    select r.uploaded_by, r.receipt_month, r.kind, r.plan, sum(r.collected_amount) as collected
    from social_insurance_records r
    where r.receipt_month between ${fromMonth} and ${toMonth}
      ${where ? sql`and ${where}` : sql``}
    group by r.uploaded_by, r.receipt_month, r.kind, r.plan
  ) g
  join social_insurance_kpi_rates k
    on k.kind = g.kind and k.plan = g.plan
   and k.year_month = (
     select max(e.year_month) from social_insurance_kpi_rates e where e.year_month <= g.receipt_month
   )
)`;

/** Điểm An Sinh theo người tải file và tháng biên lai: cột `uploaded_by`, `receipt_month`, `points`. */
const socialInsurancePoints = (fromMonth: string, toMonth: string, userId?: string) => sql`(
  select p.uploaded_by, p.receipt_month, sum(p.points) as points
  from ${socialInsuranceGroupPoints(fromMonth, toMonth, userId ? sql`r.uploaded_by = ${userId}` : undefined)} p
  group by p.uploaded_by, p.receipt_month
)`;

export type SocialInsuranceGroup = {
  kind: SocialInsuranceKind;
  plan: SocialInsurancePlan;
  collectedCents: number;
  /** Doanh thu cho 1 điểm, đồng. */
  revenuePerPoint: number;
  points: number;
};

/** Phần diễn giải của điểm An Sinh một tháng: tiền thu ra điểm theo từng nhóm, của từng người. */
export async function socialInsuranceGroupsOf(
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, SocialInsuranceGroup[]>> {
  if (userIds.length === 0) return new Map();
  const result = await db.execute<{
    uploaded_by: string;
    kind: SocialInsuranceKind;
    plan: SocialInsurancePlan;
    collected: string;
    revenue_per_point: number;
    points: number;
  }>(
    sql`select p.uploaded_by, p.kind, p.plan, p.collected::text, p.revenue_per_point, p.points::float
        from ${socialInsuranceGroupPoints(
          yearMonth,
          yearMonth,
          sql`r.uploaded_by in (${sql.join(
            userIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        )} p
        order by p.kind, p.plan`,
  );
  const groups = new Map<string, SocialInsuranceGroup[]>();
  for (const row of result.rows) {
    const group: SocialInsuranceGroup = {
      kind: row.kind,
      plan: row.plan,
      collectedCents: centsFromDecimal(row.collected),
      revenuePerPoint: row.revenue_per_point,
      points: row.points,
    };
    const kept = groups.get(row.uploaded_by);
    if (kept) kept.push(group);
    else groups.set(row.uploaded_by, [group]);
  }
  return groups;
}

/**
 * Doanh thu BHYT/BHXH của một phòng theo tháng biên lai: hồ sơ do người trong
 * phòng tải lên, chia theo người tải, loại, phương án. Điểm cùng cách tính với
 * điểm KPI; nhóm chưa có mức điểm thì điểm 0 mà doanh thu vẫn đủ.
 */
export async function socialInsuranceOfDepartment(
  departmentId: string,
  yearMonth: string,
): Promise<
  {
    uploadedBy: string;
    kind: SocialInsuranceKind;
    plan: SocialInsurancePlan;
    records: number;
    collectedCents: number;
    points: number;
  }[]
> {
  const inDepartment = sql`r.uploaded_by_department_id = ${departmentId}`;
  const [totals, scored] = await Promise.all([
    db.execute<{
      uploaded_by: string;
      kind: SocialInsuranceKind;
      plan: SocialInsurancePlan;
      records: number;
      collected: string;
    }>(sql`
      select r.uploaded_by, r.kind, r.plan, count(*)::int as records, sum(r.collected_amount)::text as collected
      from social_insurance_records r
      where r.receipt_month = ${yearMonth} and ${inDepartment}
      group by r.uploaded_by, r.kind, r.plan
    `),
    db.execute<{ uploaded_by: string; kind: string; plan: string; points: number }>(
      sql`select p.uploaded_by, p.kind, p.plan, p.points::float
          from ${socialInsuranceGroupPoints(yearMonth, yearMonth, inDepartment)} p`,
    ),
  ]);
  const pointsOf = new Map(scored.rows.map((r) => [`${r.uploaded_by}|${r.kind}|${r.plan}`, r.points]));
  return totals.rows.map((r) => ({
    uploadedBy: r.uploaded_by,
    kind: r.kind,
    plan: r.plan,
    records: r.records,
    collectedCents: centsFromDecimal(r.collected),
    points: pointsOf.get(`${r.uploaded_by}|${r.kind}|${r.plan}`) ?? 0,
  }));
}

async function socialInsurancePointsOf(conn: Db, userId: string, yearMonth: string): Promise<number> {
  const result = await conn.execute<{ points: number }>(
    sql`select coalesce(sum(p.points), 0)::float as points
        from ${socialInsurancePoints(yearMonth, yearMonth, userId)} p`,
  );
  return result.rows[0]?.points ?? 0;
}

export type ServiceTier = { coefficient: number; count: number };

/**
 * Điểm dịch vụ của một người trong khoảng ngày, gộp theo loại, kèm số lượt được
 * tính theo từng hệ số. Loại không có lượt được tính thì vắng mặt. Lượt vượt trần
 * không điểm không có trong `tiers`.
 */
export async function servicePointsByType(
  userId: string,
  from: string,
  to: string,
): Promise<Map<string, { points: number; tiers: ServiceTier[] }>> {
  const result = await db.execute<{ service_type_id: string; coefficient: number; count: number }>(
    sql`select c.service_type_id, c.coefficient::float as coefficient, count(*)::int as count
        from ${countedServices(from, to, userId)} c
        group by c.service_type_id, c.coefficient
        order by c.coefficient desc`,
  );
  const byType = new Map<string, { points: number; tiers: ServiceTier[] }>();
  for (const r of result.rows) {
    const entry = byType.get(r.service_type_id) ?? { points: 0, tiers: [] };
    entry.points += r.coefficient * r.count;
    entry.tiers.push({ coefficient: r.coefficient, count: r.count });
    byType.set(r.service_type_id, entry);
  }
  return byType;
}

/** Điểm của từng lượt dịch vụ `ids` của một người. Lượt không được tính điểm thì vắng mặt. */
export async function countedServicePoints(
  userId: string,
  from: string,
  to: string,
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const result = await db.execute<{ id: string; points: number }>(
    sql`select c.id, c.coefficient::float as points from ${countedServices(from, to, userId)} c
        where c.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
  );
  return new Map(result.rows.map((r) => [r.id, r.points]));
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
  // Tháng và ngày tra luật đều theo NGÀY HỒ SƠ khách, không theo ngày mở từng
  // tài khoản (chốt 2026-09-16, xem `customerDay.ts`). `openedDate` của
  // `ScoringAccount` vì thế mang ngày hồ sơ.
  const rows = await conn
    .select({
      customerId: bankAccounts.customerId,
      bankCode: banks.code,
      appInstalled: bankAccounts.appInstalled,
      openedDate: customerDayText,
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
        customerDayBetween(from, to),
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
      openedDate: customerDayText,
      household: bankAccounts.accountType,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .where(
      and(
        inArray(bankAccounts.customerId, customerIds),
        eq(bankAccounts.status, "done"),
        customerDayBetween(from, to),
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
/** Loại phòng của người đó TRONG tháng đang tính, đọc từ nhân sự của tháng. */
async function departmentTypeOf(conn: Db, userId: string, yearMonth: string) {
  const [row] = await conn
    .select({ type: departments.type })
    .from(staffRoster)
    .leftJoin(departments, eq(departments.id, staffRoster.departmentId))
    .where(and(eq(staffRoster.userId, userId), eq(staffRoster.yearMonth, yearMonth)));
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

  // Tháng đã chốt lương: điểm đứng yên theo số đã trả, kể cả khi đường ghi nào đó vẫn gọi tới đây.
  if (await isMonthClosed(yearMonth, tx)) return;

  /**
   * Phòng chưa có công thức thì XOÁ dòng điểm, không ghi 0 (spec §7.0).
   *
   * Còn dòng nghĩa là "đã chấm theo công thức của kỳ". Ghi 0 cho người phòng
   * `office` là nói họ làm mà không được điểm nào, trong khi thật ra chưa ai
   * viết công thức cho công của họ.
   *
   * Phòng lấy theo nhân sự của THÁNG đang tính (chốt 2026-09-30): người chuyển
   * từ phòng kinh doanh sang phòng `office` giữ điểm của các tháng còn ở phòng
   * kinh doanh.
   */
  if (!kpiAppliesTo(await departmentTypeOf(tx, userId, yearMonth))) {
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
  const socialInsurance = await socialInsurancePointsOf(tx, userId, yearMonth);
  const banking = bankingPointsFor(accounts, yearMonth, granted);

  await tx
    .insert(kpiScores)
    .values({
      userId,
      yearMonth,
      bankingPoints: String(banking),
      servicePoints: String(service),
      socialInsurancePoints: String(socialInsurance),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [kpiScores.userId, kpiScores.yearMonth],
      set: {
        bankingPoints: String(banking),
        servicePoints: String(service),
        socialInsurancePoints: String(socialInsurance),
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
export async function recomputeKpiForCustomer(customerId: string): Promise<void> {
  const [row] = await db
    .select({ ownerId: customers.createdBy, day: customerDayText })
    .from(customers)
    .where(eq(customers.id, customerId));

  // Tháng lấy từ NGÀY HỒ SƠ, không từ tài khoản (chốt 2026-09-16): mọi tài
  // khoản của một hồ sơ nằm chung một tháng, nên hàm tự tra, nơi gọi không
  // truyền tháng nữa. Dời ngày hồ sơ qua tháng khác thì `updateCustomer` tự gọi
  // `recomputeKpi` cho tháng cũ.
  if (row?.ownerId) {
    await recomputeKpi(row.ownerId, row.day.slice(0, 7));
    // Cùng nguồn `done` và cùng ngày hồ sơ với KPI. Gắn ở cửa chung này để mọi
    // đường hoàn thành, đánh lỗi, duyệt lại và xoá tài khoản không thể quên cập
    // nhật ngày công trong khi vẫn cập nhật điểm.
    await recomputeWorkDayForCustomer(customerId);
  }
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
    // Mọi người thuộc tháng đó, kể cả người đã khoá về sau: điểm tháng cũ của
    // họ vẫn vào lương quản lý.
    const rows = await tx
      .select({ id: staffRoster.userId })
      .from(staffRoster)
      .where(eq(staffRoster.yearMonth, yearMonth))
      .orderBy(asc(staffRoster.userId));
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
  const fromMonth = range.from.slice(0, 7);
  const toMonth = range.to.slice(0, 7);
  const fullMonths = {
    from: range.from === monthRange(fromMonth).from ? fromMonth : shiftMonth(fromMonth, 1),
    to: range.to === monthRange(toMonth).to ? toMonth : shiftMonth(toMonth, -1),
  };
  const [accountRows, serviceRows, socialInsuranceRows, grantRows] = await Promise.all([
    db
      .select({
        userId: customers.createdBy,
        departmentId: staffRoster.departmentId,
        customerId: bankAccounts.customerId,
        bankCode: banks.code,
        appInstalled: bankAccounts.appInstalled,
        openedDate: customerDayText,
        accountType: bankAccounts.accountType,
      })
      .from(bankAccounts)
      .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
      .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
      // Phòng của người lập hồ sơ TRONG tháng của hồ sơ, không phải phòng hiện tại.
      .innerJoin(
        staffRoster,
        and(
          eq(staffRoster.userId, customers.createdBy),
          eq(staffRoster.yearMonth, sql`left(${customerDayText}, 7)`),
        ),
      )
      .innerJoin(departments, eq(departments.id, staffRoster.departmentId))
      .where(
        and(
          eq(departments.type, "sales"),
          eq(bankAccounts.status, "done"),
          customerDayBetween(range.from, range.to),
        ),
      ),
    db
      .execute<{ userId: string; departmentId: string; points: number }>(
        sql`select c.created_by as "userId", c.department_id as "departmentId",
                   sum(c.coefficient)::float as points
            from ${countedServices(range.from, range.to)} c
            join departments d on d.id = c.department_id
            where d.type = 'sales'
            group by c.created_by, c.department_id`,
      )
      .then((result) => result.rows),
    // Biên lai chỉ có tháng, không có ngày: điểm An Sinh chỉ vào kỳ phủ trọn
    // tháng đó. Kỳ "Hôm nay" mà cộng cả tháng thì Phòng An Sinh đứng đầu mọi ngày.
    fullMonths.from <= fullMonths.to
      ? db
          .execute<{ userId: string; departmentId: string; points: number }>(
            sql`select p.uploaded_by as "userId", r.department_id as "departmentId",
                       sum(p.points)::float as points
                from ${socialInsurancePoints(fullMonths.from, fullMonths.to)} p
                join staff_roster r on r.user_id = p.uploaded_by and r.year_month = p.receipt_month
                join departments d on d.id = r.department_id
                where d.type = 'sales'
                group by p.uploaded_by, r.department_id`,
          )
          .then((result) => result.rows)
      : Promise.resolve([]),
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
  // Hai số lẻ như `kpi_scores`: điểm dịch vụ có mức 0,01 mỗi lượt.
  const add = (userId: string, departmentId: string | null, points: number) => {
    const cur = out.get(userId);
    if (cur) cur.points = roundPoints(cur.points + points);
    else out.set(userId, { departmentId, points: roundPoints(points) });
  };

  for (const [userId, staff] of byStaff)
    for (const [month, accounts] of staff.months)
      add(userId, staff.departmentId, bankingPointsFor(accounts, month, granted));

  for (const r of serviceRows) if (r.userId) add(r.userId, r.departmentId, r.points);
  for (const r of socialInsuranceRows) add(r.userId, r.departmentId, r.points);

  return out;
}

/** Cùng con số, cuộn lên PHÒNG của người lập hồ sơ. */
export async function pointsByDepartmentInRange(range: Range): Promise<Map<string, number>> {
  const byStaff = await pointsByStaffInRange(range);
  const out = new Map<string, number>();
  for (const { departmentId, points } of byStaff.values()) {
    if (!departmentId) continue;
    out.set(departmentId, roundPoints((out.get(departmentId) ?? 0) + points));
  }
  return out;
}

/**
 * Số khách đạt Combo 2 hoặc Combo 3 của từng người trong tháng — thưởng combo
 * của nhân viên điểm ATM. Cùng nguồn tài khoản với điểm ngân hàng.
 */
export async function multiBankComboCounts(
  userIds: string[],
  yearMonth: string,
): Promise<Map<string, number>> {
  const { from, to } = monthRange(yearMonth);
  const out = new Map<string, number>();
  for (const userId of userIds)
    out.set(userId, multiBankComboCountFor(await scoringAccountsOf(db, userId, from, to), yearMonth));
  return out;
}

/**
 * Tính lại điểm và ngày công của MỘT người sau khi đổi cách tính lương, phòng
 * hoặc chức vụ: điểm dịch vụ và ngày công theo lượt dịch vụ chỉ có ở nhóm `atm`,
 * ngày công theo chấm công có ở nhóm `atm` và Phòng An Sinh.
 *
 * Chỉ từ tháng đang chạy: tháng trước đọc nhân sự đã chụp (`staff_months`), sửa
 * hồ sơ không đổi chúng. Dựng lại tháng trước theo luật hiện tại là đụng số của
 * tháng chưa chốt mà không ai sửa gì.
 *
 * Phủ mọi ngày người đó có lượt dịch vụ, lượt chấm công, hồ sơ khách tự lập hoặc
 * ngày công. Thiếu nguồn hồ sơ khách thì chuyển nhầm sang An Sinh rồi chuyển lại
 * là mất ngày công theo tài khoản.
 */
export async function recomputeForSalaryScheme(userId: string): Promise<void> {
  const from = monthRange(businessMonth()).from;
  const result = await db.execute<{ day: string }>(sql`
    select to_char(d, 'YYYY-MM-DD') as day from (
      select service_date as d from services where created_by = ${userId}
      union
      select work_date from attendance_checks where user_id = ${userId}
      union
      select (created_at at time zone 'Asia/Ho_Chi_Minh')::date from customers where created_by = ${userId}
      union
      select work_date from employee_work_days where user_id = ${userId}
    ) days
    where d >= ${from}::date
  `);
  const days = result.rows.map((r) => r.day);
  const months = new Set([businessMonth(), ...days.map((day) => day.slice(0, 7))]);
  for (const month of months) await recomputeKpi(userId, month);
  for (const day of days) await recomputeEmployeeWorkDay(userId, day);
}

