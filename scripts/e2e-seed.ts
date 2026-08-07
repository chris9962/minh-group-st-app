/**
 * Dựng 5 tài khoản test cho e2e — mỗi chức vụ một cái, mang ĐÚNG bộ quyền mặc
 * định của chức vụ đó (`lib/roles.ts`).
 *
 * Vì sao không dùng tài khoản thật: quyền của một người nằm ở các dòng riêng
 * trong `user_permissions`, không đọc lại từ chức vụ. Tài khoản đang chạy đã bị
 * sửa quyền tay nhiều lần nên không đại diện cho thiết kế — test bám vào chúng
 * thì đo được thói quen của một hệ thống cụ thể, không đo được bản thiết kế.
 *
 * Mật khẩu để trần trong file này là CỐ Ý: e2e phải đăng nhập qua đúng form
 * thật. Các tài khoản này bị xoá ngay sau khi chạy (`e2e-clean.ts`).
 */
import { hashSync } from "bcryptjs";
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
  insuranceOrders,
  kpiScores,
  referralCodes,
  services,
  sessions,
  userManagedDepartments,
  userPermissions,
  users,
} from "../src/server/db/schema";
import { ROLE_PERMISSIONS } from "../src/lib/roles";
import { ROLE_TITLE, type RoleKey } from "../src/lib/types";

export const E2E_PREFIX = "zz_e2e_";
export const E2E_PASSWORD = "E2eTest!2026";
export const E2E_ROLES: RoleKey[] = [
  "director",
  "deputy-director",
  "head",
  "deputy-head",
  "staff",
];

const [dept] = await db.select({ id: departments.id }).from(departments).limit(1);
if (!dept) throw new Error("Chưa có phòng ban nào — chạy `bun db:seed` trước.");

/**
 * Chạy lại được nhiều lần: dọn tàn dư của lần trước rồi mới dựng.
 *
 * Thứ tự bắt buộc — `sessions` và `audit_log` đều trỏ vào `users.id`, xoá người
 * trước là vướng khoá ngoại. Lần chạy trước để lại phiên đăng nhập của e2e và
 * nhật ký do chính e2e sinh ra, cả hai đều là rác của test.
 */
// Khách test của lần trước phải đi trước tài khoản người dùng: `bank_accounts`
// và `insurance_orders` trỏ vào `users.id` qua `created_by`.
const staleCustomers = await db
  .select({ id: customers.id })
  .from(customers)
  .where(like(customers.fullName, "ZZE2E%"));
for (const c of staleCustomers) {
  // Dòng thời gian trạng thái trỏ vào đơn và không cascade — xoá đơn trước là
  // vướng khoá ngoại, và lần chạy sau hỏng ngay từ bước đăng nhập.
  await db.execute(
    sql`delete from insurance_order_status_history
        where order_id in (select id from insurance_orders where customer_id = ${c.id})`,
  );
  await db.delete(insuranceOrders).where(eq(insuranceOrders.customerId, c.id));
  await db.delete(services).where(eq(services.customerId, c.id));
  await db.delete(bankAccounts).where(eq(bankAccounts.customerId, c.id));
  await db.delete(customerPhones).where(eq(customerPhones.customerId, c.id));
  await db.delete(customers).where(eq(customers.id, c.id));
}
await db.delete(referralCodes).where(like(referralCodes.code, "ZZE2E%"));

const stale = await db.select({ id: users.id }).from(users).where(like(users.username, `${E2E_PREFIX}%`));
for (const u of stale) {
  await db.delete(auditLog).where(eq(auditLog.actorId, u.id));
  await db.delete(sessions).where(eq(sessions.userId, u.id));
  await db.delete(userPermissions).where(eq(userPermissions.userId, u.id));
  await db.delete(kpiScores).where(eq(kpiScores.userId, u.id));
  await db.delete(userManagedDepartments).where(eq(userManagedDepartments.userId, u.id));
  await db.delete(users).where(eq(users.id, u.id));
}

/**
 * Vai quản lý phải THẬT SỰ quản một phòng, không chỉ mang chức danh.
 *
 * Bộ quyền mặc định cho ba vai này phạm vi `phòng tôi quản`, mà phạm vi đó đọc
 * từ `user_managed_departments` chứ không đọc từ chức vụ. Dựng thiếu dòng đó
 * thì `manage_scope` là `none`, `managed` hoá tập RỖNG, và họ mở màn nghiệp vụ
 * nào cũng ra bảng trắng — kể cả bản ghi của chính mình, vì `managed` rộng hơn
 * `own` nên được chọn trước rồi phân giải ra không gì cả.
 *
 * Ba vai đó vì vậy từng không kiểm được thứ gì: mọi ca "quản lý xem được dữ
 * liệu của phòng" đều xanh vì bảng rỗng nên không có dòng nào sai để mà bắt.
 */
const MANAGES_A_DEPARTMENT: RoleKey[] = ["deputy-director", "head", "deputy-head"];

const hash = hashSync(E2E_PASSWORD, 10);
for (const [i, role] of E2E_ROLES.entries()) {
  const [u] = await db
    .insert(users)
    .values({
      username: `${E2E_PREFIX}${role}`,
      fullName: `E2E ${ROLE_TITLE[role]}`,
      phone: `09880000${i}0`,
      passwordHash: hash,
      role,
      title: ROLE_TITLE[role],
      departmentId: dept.id,
      // Giám đốc KHÔNG liệt kê từng phòng — mở phòng mới mà quên thêm vào danh
      // sách thì giám đốc mù một phòng và hệ thống không báo gì.
      manageScope: role === "director" ? "company" : MANAGES_A_DEPARTMENT.includes(role) ? "listed" : "none",
      active: true,
    })
    .returning({ id: users.id });

  if (MANAGES_A_DEPARTMENT.includes(role))
    await db.insert(userManagedDepartments).values({ userId: u.id, departmentId: dept.id });

  await db
    .insert(userPermissions)
    .values(
      ROLE_PERMISSIONS[role].map((p) => ({
        userId: u.id,
        module: p.module,
        action: p.action,
        scope: p.scope,
      })),
    )
    .onConflictDoNothing();
}

/* ── Khách hàng mẫu cho P-40 ───────────────────────────────────────────── */

/**
 * Sáu hồ sơ khách với SỐ TÀI KHOẢN và SỐ ĐƠN BH cố ý ngược nhau.
 *
 * Ngược nhau là chủ đích: sắp theo hai cột đó phải cho hai thứ tự KHÁC HẲN. Nếu
 * mọi khách cùng số như nhau thì ca test sắp xếp luôn xanh kể cả khi máy chủ sắp
 * nhầm cột — đúng cái bẫy đã dính một lần lúc đo hiệu năng.
 *
 * `nhap` là tài khoản `creating` — lượt giữ chỗ mã (spec §4.5), KHÔNG được tính
 * vào cột "Số tài khoản". C và E mang bản nháp để ca test bắt được nếu ai đó bỏ
 * điều kiện `status = 'done'`.
 */
/**
 * Tiền tố riêng cho khách mẫu, KHÁC `ZZE2E` trơn.
 *
 * Ca test tìm theo tiền tố này để lấy đúng 6 hồ sơ. Dùng `ZZE2E` trơn thì hồ sơ
 * do chính ca "thêm khách hàng" tạo ra cũng lọt vào, và ca so thứ tự sắp xếp đỏ
 * vì thừa một dòng — đỏ vì dữ liệu test, không phải vì ứng dụng sai.
 * Vẫn bắt đầu bằng `ZZE2E` nên `e2e-clean.ts` dọn được.
 */
export const E2E_CUSTOMER_TAG = "ZZE2E-KH";

const E2E_CUSTOMERS = [
  { ten: "A Nguyễn Thị Bích Trâm", cccd: "092301004871", done: 5, nhap: 2, bh: 0 },
  { ten: "B Đặng Văn Bốn", cccd: null, done: 3, nhap: 0, bh: 1 },
  { ten: "C Lê Hoàng Cường", cccd: null, done: 0, nhap: 4, bh: 4 },
  { ten: "D Phạm Minh Dung", cccd: null, done: 1, nhap: 0, bh: 3 },
  { ten: "E Huỳnh Thị Em", cccd: null, done: 3, nhap: 1, bh: 2 },
  { ten: "F Vũ Văn Phong", cccd: null, done: 0, nhap: 0, bh: 5 },
];

const [seedBank] = await db.select({ id: banks.id }).from(banks).limit(1);
const [seedChannel] = await db.select({ id: channels.id, name: channels.name }).from(channels).limit(1);
if (!seedBank || !seedChannel) throw new Error("Thiếu danh mục ngân hàng/kênh — chạy `bun db:seed` trước.");

// Mã riêng của test, không mượn mã thật: tài khoản test làm mã thật hết chỗ thì
// hôm sau nhân viên mở tài khoản không có mã dùng.
const [seedCode] = await db
  .insert(referralCodes)
  .values({ bankId: seedBank.id, code: `ZZE2E-MA`, total: 999 })
  .onConflictDoNothing()
  .returning({ id: referralCodes.id });
const codeId =
  seedCode?.id ??
  (await db.select({ id: referralCodes.id }).from(referralCodes).where(eq(referralCodes.code, "ZZE2E-MA")).limit(1))[0]
    .id;

const [seedActor] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.username, `${E2E_PREFIX}staff`))
  .limit(1);

for (const [i, c] of E2E_CUSTOMERS.entries()) {
  const [row] = await db
    .insert(customers)
    .values({
      fullName: `${E2E_CUSTOMER_TAG} ${c.ten}`,
      idNumber: c.cccd,
      address: "ZZE2E địa chỉ",
      // Chỉ khách đầu có kênh — ca lọc kênh cần một tập con thật sự nhỏ hơn.
      channelId: i === 0 ? seedChannel.id : null,
      createdBy: seedActor?.id ?? null,
    })
    .returning({ id: customers.id });

  await db.insert(customerPhones).values({
    customerId: row.id,
    number: `0901${String(230000 + i).padStart(6, "0")}`,
    isPrimary: true,
  });
  // Khách đầu có thêm số phụ — ca "tìm ra khách qua số KHÔNG phải số chính".
  if (i === 0)
    await db.insert(customerPhones).values({ customerId: row.id, number: "0987654321", isPrimary: false });

  for (let k = 0; k < c.done; k++)
    await db.insert(bankAccounts).values({
      customerId: row.id,
      bankId: seedBank.id,
      referralCodeId: codeId,
      status: "done",
      accountNumber: `ZZE2E${i}${k}`,
      openedDate: "2026-08-01",
      createdBy: seedActor?.id ?? null,
      createdByDepartmentId: dept.id,
    });

  for (let k = 0; k < c.nhap; k++)
    await db.insert(bankAccounts).values({
      customerId: row.id,
      bankId: seedBank.id,
      referralCodeId: codeId,
      status: "creating",
      createdBy: seedActor?.id ?? null,
      createdByDepartmentId: dept.id,
    });

  for (let k = 0; k < c.bh; k++)
    await db.insert(insuranceOrders).values({
      orderCode: `ZZE2E-${i}-${k}`,
      customerId: row.id,
      // Ngày TẠO ĐƠN — cột không có default (xem `schema.ts`), phải truyền tay.
      orderDate: "2026-08-01",
      product: "motorbike",
      packageName: "ZZE2E gói",
      licensePlate: `59X1-${i}${k}`,
      vehicleType: "1001",
      startDate: "2026-08-01",
      endDate: "2027-08-01",
      source: "self",
      beneficiaryName: `ZZE2E ${c.ten}`,
      createdBy: seedActor?.id ?? null,
      createdByDepartmentId: dept.id,
    });
}

/**
 * Khách độn cho ca PHÂN TRANG — 22 hồ sơ, vượt `PAGE_SIZE` = 15 nên có thật hai
 * trang.
 *
 * Tiền tố riêng `ZZE2E-PG`, không lẫn với `ZZE2E-KH` của ca sắp xếp: ca sắp xếp
 * so thứ tự của ĐÚNG 6 hồ sơ, thừa một dòng là đỏ oan.
 *
 * TẤT CẢ CÙNG MỘT TÊN — đó là chỗ hoà thật khi sắp xếp, và trùng tên ở Việt Nam
 * là chuyện thường ngày. Không có khoá phụ duy nhất trong `ORDER BY` thì thứ tự
 * giữa chúng bám theo vị trí vật lý của dòng, mà chỉ cần ai đó SỬA một hồ sơ là
 * dòng đó nhảy xuống cuối bảng — hồ sơ thứ 15 bị sửa thì sang trang 2 hiện lại,
 * còn một người khác rơi khỏi cả hai trang.
 */
export const E2E_PAGING_TAG = "ZZE2E-PG";
export const E2E_PAGING_COUNT = 22;

for (let i = 0; i < E2E_PAGING_COUNT; i++) {
  const [row] = await db
    .insert(customers)
    // Cùng tên y hệt nhau — xem chú thích trên. Số thứ tự chỉ nằm ở SĐT.
    .values({ fullName: `${E2E_PAGING_TAG} Nguyễn Văn An`, createdBy: seedActor?.id ?? null })
    .returning({ id: customers.id });
  await db.insert(customerPhones).values({
    customerId: row.id,
    number: `0902${String(100000 + i).padStart(6, "0")}`,
    isPrimary: true,
  });
}

console.log(
  `✅ dựng ${E2E_ROLES.length} tài khoản e2e (${E2E_PREFIX}*) + ${E2E_CUSTOMERS.length} khách ZZE2E-KH + ${E2E_PAGING_COUNT} khách ZZE2E-PG`,
);
process.exit(0);
