import { and, eq, gte, lte, sql } from "drizzle-orm";
import { monthRange } from "@/lib/format";
import { bankingPointsFor, type ScoringAccount } from "@/rules";
import { db } from "./db/client";
import { bankAccounts, banks, kpiScores, services, serviceTypes, users } from "./db/schema";

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
 *   TODO(KPI, chờ đường sửa tài khoản đã hoàn thành):
 *     - tích / bỏ tích "đã cài app" trên bản ghi `done`
 *
 * Đường đó chưa tồn tại: P-22 và hộp thoại sửa trên P-21 đều chỉ cho thay ẢNH
 * khi tài khoản đã `done`. Ngày mở nó ra thì thêm lời gọi ở đây cùng lúc.
 *
 * ⚠️ NGÀY `bankingPointsFor` THÔI TRẢ 0: mọi dòng đã lưu ở đây thành cũ và
 * KHÔNG tự sửa — chúng chỉ được tính lại khi có người ghi tài khoản mới. Lúc đó
 * phải chạy tay một lần: xoá sạch `kpi_scores` rồi gọi `recomputeKpiForMonth`
 * cho từng tháng đã có dữ liệu.
 */

/** Điểm dịch vụ giữ cách cũ: Σ hệ số loại dịch vụ (spec §7.2), vẫn tính được bằng SQL. */
async function servicePointsOf(userId: string, from: string, to: string): Promise<number> {
  const [row] = await db
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
 */
async function scoringAccountsOf(
  userId: string,
  from: string,
  to: string,
): Promise<ScoringAccount[]> {
  const rows = await db
    .select({
      customerId: bankAccounts.customerId,
      bankCode: banks.code,
      appInstalled: bankAccounts.appInstalled,
      openedDate: bankAccounts.openedDate,
    })
    .from(bankAccounts)
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .where(
      and(
        eq(bankAccounts.createdBy, userId),
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
  }));
}

/** Tính lại điểm của MỘT người trong MỘT tháng. */
export async function recomputeKpi(userId: string, yearMonth: string): Promise<void> {
  const { from, to } = monthRange(yearMonth);

  const [accounts, service] = await Promise.all([
    scoringAccountsOf(userId, from, to),
    servicePointsOf(userId, from, to),
  ]);

  const banking = bankingPointsFor(accounts, yearMonth);

  await db
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
