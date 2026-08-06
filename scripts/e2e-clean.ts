/**
 * Xoá sạch dấu vết của e2e: tài khoản `zz_e2e_*` và mọi bản ghi test mang tiền
 * tố `ZZE2E`.
 *
 * Chạy CẢ KHI test hỏng giữa chừng (`bun run e2e` dùng `;` chứ không phải `&&`)
 * — bỏ lại một dòng danh mục rác thì lần sau ca "đếm số dòng" sai mà không ai
 * hiểu vì sao.
 *
 * Và chạy CẢ TRƯỚC lượt seed, không chỉ sau: dọn ở cuối thôi thì một lần chạy
 * bị `Ctrl-C` giữa chừng, hoặc một lần gọi thẳng `npx playwright test` bỏ qua
 * quy trình, là lần sau thừa hưởng nguyên đống rác. Đã dính thật — ca "hai ấp
 * trùng tên" và ca "thêm kênh trùng tên" đỏ luân phiên, mỗi lần một ca, mà ứng
 * dụng không có lỗi nào.
 *
 * `audit_log` trỏ vào `users.id`, nên phải xoá nhật ký của tài khoản test trước
 * rồi mới xoá được tài khoản. Đây là nhật ký do chính test sinh ra, không phải
 * dấu vết thật của người dùng.
 */
import { eq, like, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import {
  auditLog,
  bankAccounts,
  banks,
  channels,
  customerPhones,
  customers,
  departments,
  giftGrants,
  insuranceOrders,
  hamlets,
  giftItems,
  hospitals,
  insurancePackages,
  kpiScores,
  referralCodes,
  serviceTypes,
  services,
  sessions,
  userManagedDepartments,
  userPermissions,
  users,
} from "../src/server/db/schema";

const TAG = "ZZE2E%";

const wiped: string[] = [];
const wipe = async (label: string, run: () => Promise<{ length: number } | unknown[]>) => {
  const rows = (await run()) as unknown[];
  if (rows.length) wiped.push(`${label}: ${rows.length}`);
};

/**
 * Khách test đi TRƯỚC mã giới thiệu và tài khoản người dùng — `bank_accounts`
 * trỏ vào cả `referral_codes` lẫn `users`, xoá ngược thứ tự là vướng khoá ngoại.
 */
const testCustomers = await db
  .select({ id: customers.id })
  .from(customers)
  .where(like(customers.fullName, TAG));
for (const c of testCustomers) {
  // `insurance_orders.gift_grant_id` trỏ vào `gift_grants`, còn `gift_grants`
  // trỏ vào `customers` và KHÔNG có `on delete cascade` — sai thứ tự là script
  // chết giữa chừng, bỏ lại cả tài khoản `zz_e2e_*` và lần chạy sau hỏng ngay
  // từ bước đăng nhập.
  // Dòng thời gian trạng thái trỏ vào đơn, cũng không cascade — xoá đơn trước
  // là script chết ngay tại đây.
  await db.execute(
    sql`delete from insurance_order_status_history
        where order_id in (select id from insurance_orders where customer_id = ${c.id})`,
  );
  await db.delete(insuranceOrders).where(eq(insuranceOrders.customerId, c.id));
  await db.delete(services).where(eq(services.customerId, c.id));
  await db.delete(giftGrants).where(eq(giftGrants.customerId, c.id));
  await db.delete(bankAccounts).where(eq(bankAccounts.customerId, c.id));
  await db.delete(customerPhones).where(eq(customerPhones.customerId, c.id));
  await db.delete(customers).where(eq(customers.id, c.id));
}
if (testCustomers.length) wiped.push(`khách hàng: ${testCustomers.length}`);

await wipe("mã giới thiệu", () =>
  db.delete(referralCodes).where(like(referralCodes.code, TAG)).returning({ id: referralCodes.id }),
);
await wipe("ấp", () => db.delete(hamlets).where(like(hamlets.name, TAG)).returning({ id: hamlets.id }));
await wipe("kênh", () => db.delete(channels).where(like(channels.name, TAG)).returning({ id: channels.id }));
await wipe("ngân hàng", () => db.delete(banks).where(like(banks.code, TAG)).returning({ id: banks.id }));
await wipe("bệnh viện", () => db.delete(hospitals).where(like(hospitals.name, TAG)).returning({ id: hospitals.id }));
await wipe("món quà", () => db.delete(giftItems).where(like(giftItems.name, TAG)).returning({ id: giftItems.id }));
await wipe("gói bảo hiểm", () =>
  db.delete(insurancePackages).where(like(insurancePackages.name, TAG)).returning({ id: insurancePackages.id }),
);
await wipe("loại dịch vụ", () =>
  db.delete(serviceTypes).where(like(serviceTypes.name, TAG)).returning({ id: serviceTypes.id }),
);

const accounts = await db.select({ id: users.id }).from(users).where(like(users.username, "zz_e2e_%"));
for (const u of accounts) {
  await db.delete(auditLog).where(eq(auditLog.actorId, u.id));
  await db.delete(sessions).where(eq(sessions.userId, u.id));
  await db.delete(userPermissions).where(eq(userPermissions.userId, u.id));
  // Phòng người này quản — khoá ngoại không cascade, xoá người trước là vướng.
  await db.delete(userManagedDepartments).where(eq(userManagedDepartments.userId, u.id));
  // Điểm KPI: ca test ghi một lượt dịch vụ là máy chủ tính lại điểm ngay và để
  // lại một dòng ở đây, dù chính bản ghi dịch vụ đã bị dọn ở trên.
  await db.delete(kpiScores).where(eq(kpiScores.userId, u.id));
  await db.delete(users).where(eq(users.id, u.id));
}
if (accounts.length) wiped.push(`tài khoản: ${accounts.length}`);

// Phòng ban đi SAU tài khoản người dùng: `users.department_id` trỏ vào nó, nên
// xoá phòng khi còn người trong đó là đứt cả lượt dọn.
await wipe("phòng ban", () =>
  db.delete(departments).where(like(departments.name, TAG)).returning({ id: departments.id }),
);

console.log(wiped.length ? `🧹 dọn ${wiped.join(" · ")}` : "🧹 không còn gì để dọn");
process.exit(0);
