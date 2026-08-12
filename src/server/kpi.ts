import { and, eq, gte, lte, sql } from "drizzle-orm";
import { monthRange } from "@/lib/format";
import { bankingPointsFor, type ScoringAccount } from "@/rules";
import { db } from "./db/client";
import { bankAccounts, banks, customers, kpiScores, services, serviceTypes, users } from "./db/schema";

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
    // Điểm KPI không xét CNKD/HKD — cờ này chỉ mở nhóm quà vật phẩm.
    household: false,
  }));
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
  const { from, to } = monthRange(yearMonth);

  await db.transaction(async (tx) => {
    /**
     * Khoá theo ĐÚNG ô điểm đang ghi, không khoá bảng: hai lượt cho cùng
     * (người, tháng) xếp hàng, hai người khác nhau vẫn chạy song song. Postgres
     * nhả khoá khi transaction kết thúc, kể cả khi có lỗi ném ra.
     *
     * Mỗi transaction lấy đúng MỘT khoá nên không có thứ tự để đảo, tức không
     * có deadlock. Sáu nơi gọi hàm này đều đứng ngoài transaction của chúng.
     */
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${yearMonth}))`,
    );

    // Nối tiếp chứ không `Promise.all`: một transaction đi trên một kết nối,
    // gửi hai câu cùng lúc lên đó là lỗi giao thức.
    const accounts = await scoringAccountsOf(tx, userId, from, to);
    const service = await servicePointsOf(tx, userId, from, to);
    const banking = bankingPointsFor(accounts, yearMonth);

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
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.active, true));
  for (const row of rows) await recomputeKpi(row.id, yearMonth);
  return rows.length;
}
