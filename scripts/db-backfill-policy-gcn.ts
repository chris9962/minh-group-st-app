import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { insuranceOrders } from "../src/server/db/schema";
import { getPolicyNumber } from "../src/server/pvi-api/policy";

/**
 * Lấp `pvi_policy_gcn` cho đơn tai nạn điện đường API đã xong TRƯỚC migration
 * 0086. Worker chỉ tra `GetPolicyNumber` cho đơn còn `awaiting-certificate`,
 * nên đơn đã `done` trước lúc deploy không tự có số.
 *
 * Chỉ nhắm vào NULL: NULL là "chưa từng hỏi", còn '' là "đã hỏi, PVI trả rỗng".
 * Chạy lại bao nhiêu lần cũng an toàn.
 *
 * Chỉ đơn đường API. Đơn bot không có `RequestId` bên PVI nên `GetPolicyNumber`
 * trả `-500`, script này không đụng tới chúng.
 *
 * Phải chạy trên máy chủ thật, vì PVI chặn theo IP:
 *   bun --env-file=.env.local scripts/db-backfill-policy-gcn.ts --dry-run
 *   bun --env-file=.env.local scripts/db-backfill-policy-gcn.ts
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await db
    .select({
      id: insuranceOrders.id,
      orderCode: insuranceOrders.orderCode,
      policyNumber: insuranceOrders.pviPolicyNumber,
    })
    .from(insuranceOrders)
    .where(
      and(
        eq(insuranceOrders.pviRoute, "api"),
        eq(insuranceOrders.product, "electric-accident"),
        isNull(insuranceOrders.pviPolicyGcn),
        ne(insuranceOrders.pviPolicyNumber, ""),
      ),
    )
    .orderBy(insuranceOrders.createdAt);

  if (rows.length === 0) {
    console.log("Không có đơn điện đường API nào còn thiếu Policy_GCN.");
    return;
  }

  console.log(`${rows.length} đơn cần lấp${dryRun ? " (CHẠY KHÔ — không ghi gì)" : ""}:`);

  let filled = 0;
  let empty = 0;
  let failed = 0;

  // PVI xác nhận 2026-09-11 là không giới hạn tần suất gọi. Vẫn giữ 20 luồng
  // để một lượt lỗi không kéo theo cả nghìn request treo cùng lúc.
  const CONCURRENCY = 20;
  let next = 0;

  async function worker() {
    while (next < rows.length) {
      const row = rows[next];
      next += 1;

      let gcn: string;
      try {
        const policy = await getPolicyNumber({ requestId: row.id });
        gcn = policy.policyGcn;
      } catch (e) {
        failed += 1;
        console.log(`  ${row.orderCode}  HỎNG  ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      if (gcn) filled += 1;
      else empty += 1;
      console.log(`  ${row.orderCode}  ${row.policyNumber}  →  ${gcn || "(rỗng)"}`);

      if (!dryRun) {
        await db
          .update(insuranceOrders)
          .set({ pviPolicyGcn: gcn })
          .where(eq(insuranceOrders.id, row.id));
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(
    `\nCó số: ${filled}. PVI trả rỗng: ${empty}. Hỏng: ${failed}.` +
      (dryRun ? " Chưa ghi gì." : " Đã ghi."),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
