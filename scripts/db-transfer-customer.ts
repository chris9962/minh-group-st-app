import { eq, inArray, sql } from "drizzle-orm";
import { auditLog, bankAccounts, customers, insuranceOrders, services, users } from "../src/server/db/schema";
import { db } from "../src/server/db/client";
import { recomputeGiftCase } from "../src/server/gift";
import { recomputeKpi } from "../src/server/kpi";
import { hasRulesFor } from "../src/rules";

/**
 * Chuyển một hồ sơ khách sang người khác. App không có đường làm việc này:
 * `created_by` chỉ ghi lúc tạo hồ sơ.
 *
 * Đổi CẢ HAI nhóm cột `created_by`, vì chúng trả lời hai câu khác nhau: ở
 * `customers` là người lập hồ sơ, và điểm KPI ngân hàng đi theo cột đó (thể lệ
 * câu 7.11); ở bản ghi nghiệp vụ là người bấm tạo, và phạm vi mức dòng của màn
 * danh sách đọc cột đó. Đổi mỗi cột đầu thì người nhận có điểm mà không thấy
 * tài khoản trong danh sách của mình.
 *
 * ⚠️ Chuyển sang người KHÁC PHÒNG là đổi rổ quà của khách chưa phát — cột
 * `created_by_department_id` là nguồn của quy đổi quà Phòng Y (thể lệ kỳ
 * 2026-08 mục 4 lưu ý 2). Đợt đã phát không đụng, `gift_grants.snapshot` đóng
 * băng.
 *
 * Xem trước, không ghi gì:
 *   bun run db:transfer-customer -- --customer=<uuid> --to=<tên đăng nhập> --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai người chịu trách nhiệm — tên đó vào `audit_log`:
 *   bun run db:transfer-customer -- --customer=<uuid> --to=<tên đăng nhập> --as=giamdoc
 */

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";

async function monthsToRecompute(customerId: string): Promise<string[]> {
  const rows = await db.execute<{ month: string }>(sql`
    select distinct to_char(opened_date, 'YYYY-MM') as month
      from bank_accounts where customer_id = ${customerId} and opened_date is not null
    union
    select distinct to_char(service_date, 'YYYY-MM') as month
      from services where customer_id = ${customerId}
  `);
  return rows.rows.map((r) => r.month).sort();
}

async function main() {
  const customerId = arg("customer");
  const toUsername = arg("to").toLowerCase();
  const asUsername = arg("as").toLowerCase();
  const dryRun = process.argv.includes("--dry-run");

  if (!customerId || !toUsername)
    throw new Error(
      "Thiếu tham số. Ví dụ:\n  bun run db:transfer-customer -- --customer=<uuid> --to=019lybtc --dry-run",
    );

  const [khach] = await db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      ownerId: customers.createdBy,
      departmentId: customers.createdByDepartmentId,
    })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!khach) throw new Error(`Không có hồ sơ khách nào mang id ${customerId}.`);

  const [nguoiNhan] = await db
    .select({ id: users.id, fullName: users.fullName, departmentId: users.departmentId, active: users.active })
    .from(users)
    .where(eq(users.username, toUsername));
  if (!nguoiNhan) throw new Error(`Không có tài khoản nào tên đăng nhập "${toUsername}".`);
  if (!nguoiNhan.active) throw new Error(`Tài khoản "${toUsername}" đã nghỉ.`);
  if (khach.ownerId === nguoiNhan.id) throw new Error(`Hồ sơ này đã thuộc "${toUsername}" rồi.`);

  const [chuCu] = khach.ownerId
    ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(eq(users.id, khach.ownerId))
    : [null];

  const dem = await db.execute<{ bang: string; so_dong: number }>(sql`
    select 'bank_accounts' as bang, count(*)::int as so_dong from bank_accounts where customer_id = ${customerId}
    union all
    select 'insurance_orders', count(*)::int from insurance_orders where customer_id = ${customerId}
    union all
    select 'services', count(*)::int from services where customer_id = ${customerId}
  `);

  const months = await monthsToRecompute(customerId);
  const thieuLuat = months.filter((m) => !hasRulesFor(m));

  console.log(`Khách:      ${khach.fullName} (${customerId})`);
  console.log(`Chủ cũ:     ${chuCu ? chuCu.fullName : "(không có)"}`);
  console.log(`Chủ mới:    ${nguoiNhan.fullName} (${toUsername})`);
  for (const r of dem.rows) console.log(`  ${r.bang}: ${r.so_dong} dòng`);
  console.log(`Tháng tính lại KPI: ${months.length ? months.join(", ") : "(không có)"}`);

  if (khach.departmentId !== nguoiNhan.departmentId)
    console.log("⚠️  Hai người KHÁC PHÒNG — rổ quà của khách sẽ đổi theo phòng người nhận.");

  // Thiếu file luật thì `recomputeKpi` ghi đè điểm ngân hàng thành 0, không lấy lại được.
  if (thieuLuat.length)
    throw new Error(`Chưa có file luật cho kỳ ${thieuLuat.join(", ")} (src/rules/) — dừng, không đổi gì.`);

  if (dryRun) {
    console.log("CHẠY KHÔ — không ghi gì.");
    return;
  }

  if (!asUsername)
    throw new Error(
      "Thiếu --as=<tên đăng nhập>. Chuyển chủ hồ sơ đổi điểm KPI của hai người, phải có người chịu trách nhiệm.",
    );
  const [actor] = await db.select({ id: users.id }).from(users).where(eq(users.username, asUsername));
  if (!actor) throw new Error(`Không có tài khoản nào tên đăng nhập "${asUsername}".`);

  await db.transaction(async (tx) => {
    const chu = { createdBy: nguoiNhan.id, createdByDepartmentId: nguoiNhan.departmentId };

    await tx.update(customers).set(chu).where(eq(customers.id, customerId));
    await tx.update(bankAccounts).set(chu).where(eq(bankAccounts.customerId, customerId));
    await tx.update(insuranceOrders).set(chu).where(eq(insuranceOrders.customerId, customerId));
    await tx.update(services).set(chu).where(eq(services.customerId, customerId));

    await tx.insert(auditLog).values({
      actorId: actor.id,
      module: "customer",
      action: "update",
      targetLabel: `db:transfer-customer chuyển hồ sơ ${khach.fullName} từ ${chuCu?.fullName ?? "(không có)"} sang ${nguoiNhan.fullName}`,
      targetTable: "customers",
      targetId: customerId,
      detail: { fromUserId: khach.ownerId, toUserId: nguoiNhan.id, months },
    });
  });

  await recomputeGiftCase(customerId);

  const nguoiCanTinhLai = [khach.ownerId, nguoiNhan.id].filter((v): v is string => Boolean(v));
  for (const month of months) for (const userId of nguoiCanTinhLai) await recomputeKpi(userId, month);

  const sau = await db
    .select({ username: users.username, fullName: users.fullName })
    .from(users)
    .where(inArray(users.id, nguoiCanTinhLai));
  console.log(`Chuyển xong. Đã tính lại KPI ${months.join(", ")} cho: ${sau.map((u) => u.username).join(", ")}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
