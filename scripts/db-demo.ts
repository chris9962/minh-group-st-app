/**
 * Dữ liệu MẪU để xem giao diện có đủ ca — `bun run db:demo`, dọn bằng
 * `bun run db:demo -- --clean`.
 *
 * Tách khỏi `db:seed` là có chủ ý: `db:seed` chỉ dựng cấu trúc và danh mục
 * THẬT, chạy được cả trên máy chủ chạy thật. File này đổ khách bịa, tài khoản
 * bịa, đơn bịa — không bao giờ được chạy trên dữ liệu thật.
 *
 * Tên đăng nhập mang tiền tố `demo_`, khách mang địa chỉ `DEMO_ADDRESS` — dọn sạch
 * mà không đụng dữ liệu người dùng tự nhập.
 *
 * Chạy lại nhiều lần: tự dọn phần cũ trước khi dựng lại.
 */
import { hashSync } from "bcryptjs";
import { and, eq, inArray, like } from "drizzle-orm";
import { businessDay, businessMonth } from "../src/lib/format";
import { ROLE_PERMISSIONS } from "../src/lib/roles";
import { db } from "../src/server/db/client";
import { giftForCustomer, recomputeGiftCase } from "../src/server/gift";
import { recomputeKpi } from "../src/server/kpi";
import {
  auditLog,
  bankAccounts,
  banks,
  channels,
  customerPhones,
  customers,
  departments,
  giftGrants,
  insuranceOrderStatusHistory,
  insuranceOrders,
  kpiScores,
  referralCodes,
  serviceTypes,
  services,
  sessions,
  userManagedDepartments,
  userPermissions,
  users,
} from "../src/server/db/schema";
import type { RoleKey } from "../src/lib/types";

const USER_PREFIX = "demo_";
const PASSWORD = "12345678";

/**
 * Địa chỉ dùng chung cho MỌI khách của bộ mẫu — và là DẤU NHẬN DIỆN của bộ.
 *
 * Bản trước đánh dấu bằng tiền tố `DEMO` trong tên khách, nhưng chuỗi đó hiện ở
 * mọi bảng và mọi ô chọn khách nên nhìn không giống dữ liệu thật. Bảng
 * `customers` không có cột nào để đánh dấu, nên chuyển dấu sang địa chỉ: một
 * địa chỉ có thật về hình thức, giống hệt nhau ở cả bộ.
 *
 * Bước dọn hỏi CẢ HAI vế — địa chỉ này VÀ người tạo là tài khoản `demo_*`. Chỉ
 * hỏi địa chỉ thì một khách thật trùng địa chỉ cũng mất; chỉ hỏi người tạo thì
 * hồ sơ thật do người thử tay lập bằng tài khoản `demo_*` cũng mất.
 */
const DEMO_ADDRESS = "12 Nguyễn Thị Minh Khai, Phường Bến Nghé, TP Hồ Chí Minh";

/**
 * Mã đơn của bộ mẫu bắt đầu từ 900 để không đụng số máy chủ cấp.
 *
 * `nextOrderCodes` ở `server/insurance.ts` đếm từ 1 lên trong bảng
 * `order_code_counters`; script này ghi thẳng vào `insurance_orders` nên không
 * đi qua bộ đếm đó. Trùng số là vi phạm ràng buộc duy nhất của `order_code`.
 */
const DEMO_ORDER_START = 900;

/**
 * Tiền tố mã giới thiệu của bộ mẫu. Mã thật do ngân hàng cấp nên dạng nào cũng
 * có; tiền tố riêng ở đây chỉ để bước dọn tìm lại đúng mã mình đã tạo.
 */
const CODE_PREFIX = "MGST";

/**
 * ⚠️ MỌI SỐ TRONG FILE NÀY PHẢI KHÔNG TRÙNG BỘ E2E (`scripts/e2e-seed.ts`).
 *
 * Hai bộ sống chung một database dev. Bộ e2e có ca "tìm bằng 4 số cuối CCCD"
 * và "tìm bằng số phụ", và chúng chốt rằng kết quả ra ĐÚNG MỘT dòng — nên chỉ
 * cần một khách mẫu trùng bốn số cuối là hai ca đó đỏ, mà đỏ vì dữ liệu chứ
 * không phải vì ứng dụng sai. Đã dính một lần.
 *
 * Bộ e2e giữ `092301004871` và `0987654321`; bộ này dùng dải `0703018850xx` và
 * `09788800xx`.
 */

const MONTH = businessMonth();
const day = (n: number) => `${MONTH}-${String(n).padStart(2, "0")}`;

/* ── Dọn ───────────────────────────────────────────────────────────────── */

async function clean() {
  const demoUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.username, `${USER_PREFIX}%`));
  const demoCustomers =
    demoUsers.length === 0
      ? []
      : await db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.address, DEMO_ADDRESS),
              inArray(
                customers.createdBy,
                demoUsers.map((u) => u.id),
              ),
            ),
          );

  const customerIds = demoCustomers.map((c) => c.id);
  if (customerIds.length > 0) {
    // Thứ tự bắt buộc: dòng thời gian trỏ vào đơn, đơn và quà trỏ vào khách.
    const orders = await db
      .select({ id: insuranceOrders.id })
      .from(insuranceOrders)
      .where(inArray(insuranceOrders.customerId, customerIds));
    if (orders.length > 0)
      await db.delete(insuranceOrderStatusHistory).where(
        inArray(
          insuranceOrderStatusHistory.orderId,
          orders.map((o) => o.id),
        ),
      );
    await db.delete(insuranceOrders).where(inArray(insuranceOrders.customerId, customerIds));
    await db.delete(services).where(inArray(services.customerId, customerIds));
    await db.delete(giftGrants).where(inArray(giftGrants.customerId, customerIds));
    await db.delete(bankAccounts).where(inArray(bankAccounts.customerId, customerIds));
    await db.delete(customerPhones).where(inArray(customerPhones.customerId, customerIds));
    await db.delete(customers).where(inArray(customers.id, customerIds));
  }

  /**
   * Chỉ xoá mã KHÔNG còn tài khoản nào trỏ tới.
   *
   * Người dùng thử tay hay mở tài khoản bằng mã `MGST-*` là mã đó thành mã của
   * họ, không còn là mã của bộ mẫu. Xoá thẳng thì bước dọn dừng giữa chừng vì
   * khoá ngoại, và lượt chạy đã xoá xong khách mẫu nhưng chưa dựng lại được —
   * bộ mẫu mất mà không báo gì.
   */
  const demoCodes = await db
    .select({ id: referralCodes.id })
    .from(referralCodes)
    .where(like(referralCodes.code, `${CODE_PREFIX}%`));
  for (const c of demoCodes) {
    const [used] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(eq(bankAccounts.referralCodeId, c.id))
      .limit(1);
    if (!used) await db.delete(referralCodes).where(eq(referralCodes.id, c.id));
  }

  for (const u of demoUsers) {
    /**
     * GIỮ LẠI người còn bản ghi ngoài bộ mẫu đứng tên.
     *
     * Người thử tay đăng nhập bằng tài khoản `demo_*` rồi lập một hồ sơ khách
     * thật thì hồ sơ đó trỏ vào `users.id`. Xoá người là vướng khoá ngoại,
     * bước dọn dừng giữa chừng và bộ mẫu mất mà không dựng lại được. `build()`
     * dùng lại chính hàng này, không dựng bản trùng.
     */
    const [owned] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.createdBy, u.id))
      .limit(1);
    if (owned) continue;

    // Bốn bảng này trỏ vào `users.id` và không cascade — xoá người trước là
    // vướng khoá ngoại ngay từ lần chạy lại thứ hai.
    await db.delete(auditLog).where(eq(auditLog.actorId, u.id));
    await db.delete(sessions).where(eq(sessions.userId, u.id));
    await db.delete(kpiScores).where(eq(kpiScores.userId, u.id));
    await db.delete(userPermissions).where(eq(userPermissions.userId, u.id));
    await db.delete(userManagedDepartments).where(eq(userManagedDepartments.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }

  console.log(
    `Đã dọn: ${customerIds.length} khách · ${demoUsers.length} tài khoản của bộ mẫu.`,
  );
}

/* ── Nhân sự mẫu ───────────────────────────────────────────────────────── */

/**
 * Sáu người ở BA phòng khác nhau, và một người ở Phòng Y.
 *
 * Bộ `db:seed` chỉ có ban giám đốc, không ai thuộc phòng kinh doanh nào — nên
 * bảng xếp hạng phòng, thống kê P-91 và luật quy đổi quà của Phòng Y đều không
 * có gì để hiện. Sáu người này là mức tối thiểu để ba màn đó nói được điều gì.
 */
const STAFF: { username: string; fullName: string; role: RoleKey; dept: string }[] = [
  { username: "demo_kd1_truong", fullName: "Trần Quốc Bảo", role: "head", dept: "KD-1" },
  { username: "demo_kd1_a", fullName: "Nguyễn Thị Lan", role: "staff", dept: "KD-1" },
  { username: "demo_kd1_b", fullName: "Lê Văn Hậu", role: "staff", dept: "KD-1" },
  { username: "demo_kd2_a", fullName: "Phạm Thu Trang", role: "staff", dept: "KD-2" },
  { username: "demo_kd2_b", fullName: "Võ Minh Khoa", role: "staff", dept: "KD-2" },
  { username: "demo_y_a", fullName: "Huỳnh Bảo Ngọc", role: "staff", dept: "PHONG-Y" },
];

/* ── Khách mẫu ─────────────────────────────────────────────────────────── */

/**
 * `type` là LOẠI TÀI KHOẢN của VPa, không phải một ngân hàng riêng (chốt
 * 2026-08-18). CNKD và HKD từng bị dựng thành hai dòng trong bảng `banks`, nên
 * ca TH1 mở một tài khoản "ngân hàng CNKD" — sai hình dạng, và luật quà đọc
 * `account_type` nên nó ra rổ đúng chỉ vì trùng hợp.
 */
type DemoAccount = {
  bank: string;
  app?: boolean;
  draft?: boolean;
  type?: "CNKD" | "HKD";
};

type DemoCustomer = {
  name: string;
  /** Có CCCD thì màn hồ sơ mới hiện được ca "che 8 số đầu" (quyết định 03/08). */
  idNumber?: string;
  /** Ghi ngay vào tên để mở màn là đọc được ca này định thử điều gì. */
  case: string;
  owner: string;
  channel?: string;
  accounts: DemoAccount[];
  insurance?: number;
  services?: number;
  gifted?: boolean;
};

/**
 * Mỗi dòng là MỘT ca của thể lệ 2026-08. Ca nào ứng với khách nào ghi ở comment
 * ngay trên từng mục, theo đúng thứ tự này.
 *
 * Tên khách là TÊN NGƯỜI, không mang dấu vết nào của bộ mẫu. Bản trước nhét kết
 * quả mong đợi vào tên (`DEMO TH3 · 3 ưu tiên · 1.2đ · 70k`) cho tiện đối chiếu
 * ở P-40, nhưng chuỗi đó hiện ra ở mọi ô chọn khách, mọi bảng và mọi hộp thoại
 * — trông không giống dữ liệu thật, và cột tên bị kéo rộng quá mức.
 *
 * Dấu nhận diện của bộ chuyển sang `DEMO_ADDRESS`, xem chú thích ở hằng số đó.
 */
const CUSTOMERS: DemoCustomer[] = [
  {
    // TH3 · 3 ngân hàng ưu tiên · 1,2đ · rổ 70k
    name: "Nguyễn Văn An",
    idNumber: "070301885001",
    case: "TH3",
    owner: "demo_kd1_a",
    accounts: [{ bank: "MB" }, { bank: "VPa" }, { bank: "MSBa" }],
    insurance: 2,
    services: 1,
  },
  {
    // TH4 · có MSBa · 1,0đ · rổ 50k
    name: "Trần Thị Bích",
    case: "TH4",
    owner: "demo_kd1_a",
    accounts: [{ bank: "MB" }, { bank: "MSBa" }, { bank: "LPB" }],
    insurance: 1,
  },
  {
    // TH5 · có VPa · 1,0đ · rổ 20k · kênh bệnh viện
    name: "Lê Hoàng Cường",
    case: "TH5",
    owner: "demo_kd1_b",
    channel: "KENH-BENH-VIEN",
    accounts: [{ bank: "MB" }, { bank: "VPa" }, { bank: "LPB" }],
    services: 2,
  },
  {
    // TH6 · 3 ngân hàng khác · 0,7đ · rổ 0đ
    name: "Phạm Thị Dung",
    case: "TH6",
    owner: "demo_kd1_b",
    accounts: [{ bank: "LPB" }, { bank: "TPB" }, { bank: "VIB" }],
  },
  {
    // TH1 · combo 2 có VPa · 0,7đ · rổ 20k
    name: "Hoàng Minh Đức",
    idNumber: "070301885002",
    case: "TH1",
    owner: "demo_kd2_a",
    accounts: [{ bank: "MB" }, { bank: "VPa" }],
    insurance: 3,
  },
  {
    // TH2 · combo 2 ngân hàng khác · 0,4đ
    name: "Vũ Thị Hà",
    case: "TH2",
    owner: "demo_kd2_a",
    accounts: [{ bank: "MSBb" }, { bank: "BIDV" }],
  },
  {
    // TH5 · có ngân hàng hạn chế VPb · 0,9đ
    name: "Đỗ Quang Huy",
    case: "TH5",
    owner: "demo_kd2_b",
    accounts: [{ bank: "MB" }, { bank: "VPa" }, { bank: "VPb" }],
  },
  {
    // TH2 · VPa chưa cài app nên tụt combo · 0,5đ
    name: "Bùi Thị Lan",
    case: "TH2",
    owner: "demo_kd2_b",
    accounts: [{ bank: "MB" }, { bank: "VPa", app: false }, { bank: "LPB" }],
  },
  {
    // TH1 · VPa kèm CNKD nên rổ có Loa và Mica
    name: "Ngô Văn Nam",
    case: "TH1",
    owner: "demo_kd1_a",
    accounts: [{ bank: "MB" }, { bank: "VPa", type: "CNKD" }, { bank: "LPB" }],
  },
  {
    // TH6 · Phòng Y quy đổi sang nón và mì
    name: "Đặng Thị Oanh",
    case: "TH6",
    owner: "demo_y_a",
    accounts: [{ bank: "LPB" }, { bank: "TPB" }, { bank: "VIB" }],
  },
  {
    // Không đủ điều kiện · mở lẻ 1 tài khoản
    name: "Trịnh Văn Phúc",
    case: "—",
    owner: "demo_kd1_b",
    accounts: [{ bank: "MB" }],
  },
  {
    // Không đủ điều kiện · MB+MSBa không thành combo 2
    name: "Lý Thị Quyên",
    case: "—",
    owner: "demo_kd2_b",
    accounts: [{ bank: "MB" }, { bank: "MSBa" }],
  },
  {
    // TH3 · đã tặng quà rồi
    name: "Cao Minh Sơn",
    idNumber: "070301885003",
    case: "TH3",
    owner: "demo_kd1_truong",
    accounts: [{ bank: "MB" }, { bank: "VPa" }, { bank: "MSBa" }],
    gifted: true,
  },
  {
    // TH1 · có bản nháp đang giữ chỗ mã
    name: "Dương Thị Tâm",
    case: "TH1",
    owner: "demo_kd1_truong",
    accounts: [{ bank: "MB" }, { bank: "VPa" }, { bank: "TPB", draft: true }],
    insurance: 1,
  },
];

/** Khách độn cho phân trang — P-40 cắt 15 dòng một trang. */
const FILLER_COUNT = 24;

/* ── Dựng ──────────────────────────────────────────────────────────────── */

async function build() {
  const bankIdByCode = new Map(
    (await db.select({ id: banks.id, code: banks.code }).from(banks)).map((b) => [b.code, b.id]),
  );
  const deptIdByCode = new Map(
    (await db.select({ id: departments.id, code: departments.code }).from(departments)).map((d) => [
      d.code,
      d.id,
    ]),
  );
  const channelIdByCode = new Map(
    (await db.select({ id: channels.id, code: channels.code }).from(channels)).map((c) => [
      c.code,
      c.id,
    ]),
  );
  const serviceTypeRows = await db.select({ id: serviceTypes.id }).from(serviceTypes);

  if (bankIdByCode.size === 0 || deptIdByCode.size === 0)
    throw new Error("Chưa có danh mục — chạy `bun run db:seed` trước.");

  /* Nhân sự */
  const hash = hashSync(PASSWORD, 10);
  const userIdByName = new Map<string, string>();
  for (const [i, s] of STAFF.entries()) {
    const [row] = await db
      .insert(users)
      .values({
        username: s.username,
        staffCode: `NV-${String(901 + i)}`,
        passwordHash: hash,
        fullName: s.fullName,
        phone: `09770000${String(i).padStart(2, "0")}`,
        role: s.role,
        title: s.role === "head" ? "Trưởng phòng" : "Nhân viên",
        departmentId: deptIdByCode.get(s.dept)!,
        manageScope: s.role === "head" ? "listed" : "none",
      })
      // Người còn bản ghi đứng tên thì `clean()` giữ lại — dùng lại hàng đó.
      .onConflictDoNothing({ target: users.username })
      .returning({ id: users.id });
    const userId =
      row?.id ??
      (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, s.username))
          .limit(1)
      )[0].id;
    userIdByName.set(s.username, userId);

    await db.delete(userPermissions).where(eq(userPermissions.userId, userId));
    await db.insert(userPermissions).values(
      ROLE_PERMISSIONS[s.role].map((p) => ({
        userId,
        module: p.module,
        action: p.action,
        scope: p.scope,
      })),
    );
    // Trưởng phòng KHÔNG có dòng này thì phạm vi `phòng tôi quản` phân giải ra
    // tập rỗng, và mọi màn nghiệp vụ của họ trắng trơn.
    if (s.role === "head")
      await db
        .insert(userManagedDepartments)
        .values({ userId, departmentId: deptIdByCode.get(s.dept)! })
        .onConflictDoNothing();
  }

  /**
   * Người NHẬN XỬ LÝ đơn bảo hiểm — cố ý chọn người ở phòng KHÁC người tạo.
   *
   * Mọi khách mẫu đều do người KD-1/KD-2 lập, nên lấy Phòng Y và trưởng KD-1
   * làm người xử lý thì dựng được ca "quản lý phòng người xử lý cũng thấy đơn",
   * thứ không quan sát được khi hai phòng trùng nhau.
   */
  const HANDLERS = (["demo_y_a", "demo_kd1_truong"] as const).map((username) => ({
    id: userIdByName.get(username)!,
    deptId: deptIdByCode.get(STAFF.find((s) => s.username === username)!.dept)!,
  }));

  /* Kho mã — mỗi ngân hàng một mã đủ chỗ cho cả bộ mẫu. */
  const codeIdByBank = new Map<string, string>();
  for (const [code, id] of bankIdByCode) {
    const [row] = await db
      .insert(referralCodes)
      .values({ bankId: id, code: `${CODE_PREFIX}-${code}`, total: 200 })
      // Mã cũ còn sót vì có tài khoản người dùng trỏ tới — dùng lại chính nó,
      // không dựng bản trùng.
      .onConflictDoNothing({ target: [referralCodes.bankId, referralCodes.code] })
      .returning({ id: referralCodes.id });
    const codeId =
      row?.id ??
      (
        await db
          .select({ id: referralCodes.id })
          .from(referralCodes)
          .where(and(eq(referralCodes.bankId, id), eq(referralCodes.code, `${CODE_PREFIX}-${code}`)))
          .limit(1)
      )[0].id;
    codeIdByBank.set(code, codeId);
  }

  /* Khách + tài khoản + đơn + dịch vụ */
  const touchedCustomers: string[] = [];
  const touchedOwners = new Set<string>();
  let phoneSeq = 0;
  let orderSeq = 0;

  for (const [i, c] of CUSTOMERS.entries()) {
    const ownerId = userIdByName.get(c.owner)!;
    const deptId = deptIdByCode.get(STAFF.find((s) => s.username === c.owner)!.dept)!;
    touchedOwners.add(ownerId);

    const [customer] = await db
      .insert(customers)
      .values({
        fullName: c.name,
        idNumber: c.idNumber ?? null,
        address: DEMO_ADDRESS,
        channelId: c.channel ? (channelIdByCode.get(c.channel) ?? null) : null,
        createdBy: ownerId,
        createdByDepartmentId: deptId,
      })
      .returning({ id: customers.id });
    touchedCustomers.push(customer.id);

    await db.insert(customerPhones).values({
      customerId: customer.id,
      number: `0912${String(100000 + phoneSeq++).padStart(6, "0")}`,
      isPrimary: true,
    });
    // Khách đầu có thêm số phụ — để thử tìm bằng số KHÔNG phải số chính.
    if (i === 0)
      await db
        .insert(customerPhones)
        .values({ customerId: customer.id, number: "0978880001", isPrimary: false });

    for (const [k, a] of c.accounts.entries()) {
      await db.insert(bankAccounts).values({
        customerId: customer.id,
        bankId: bankIdByCode.get(a.bank)!,
        referralCodeId: codeIdByBank.get(a.bank)!,
        status: a.draft ? "creating" : "done",
        accountNumber: a.draft ? null : `19${String(90_000_000 + i * 100 + k)}`,
        openedDate: a.draft ? null : day(3 + (i % 20)),
        appInstalled: a.app ?? true,
        accountType: a.type ?? "none",
        createdBy: ownerId,
        createdByDepartmentId: deptId,
      });
    }

    // Đơn bảo hiểm rải đều bốn trạng thái đang dùng, để P-13 lọc ra dòng nào
    // cũng có dữ liệu và hàng đợi làm tay P-15 không rỗng.
    const STATUSES = ["manual-queued", "manual-progress", "done", "manual-queued"] as const;
    for (let n = 0; n < (c.insurance ?? 0); n++) {
      const status = STATUSES[n % STATUSES.length];
      /**
       * Đơn đã rời hàng chờ thì PHẢI có người xử lý — `handled_by` chỉ được ghi
       * qua nút "Nhận đơn xử lý", mà script ghi thẳng vào bảng nên phải tự đặt.
       *
       * Người xử lý cố ý ở PHÒNG KHÁC người tạo: luật nhìn thấy đơn cho cấp
       * quản lý của cả hai phòng, và chỉ dựng lại được ca đó khi hai phòng khác
       * nhau. Bộ mẫu cũ để `handled_by` rỗng nên ca này vô hình.
       */
      const handler = status === "manual-queued" ? null : HANDLERS[n % HANDLERS.length];
      await db.insert(insuranceOrders).values({
        orderCode: `DH-${MONTH.slice(2, 4)}${MONTH.slice(5, 7)}-${String(DEMO_ORDER_START + ++orderSeq)}`,
        customerId: customer.id,
        product: n % 2 === 0 ? "motorbike" : "electric-accident",
        packageName: n % 2 === 0 ? "1 năm BH xe máy" : "1 năm BH tai nạn điện",
        fee: 100_000,
        orderDate: day(5 + n),
        startDate: day(5 + n),
        endDate: `${Number(MONTH.slice(0, 4)) + 1}-${MONTH.slice(5, 7)}-05`,
        status,
        source: "self",
        beneficiaryName: c.name,
        // Người thụ hưởng chính là khách — CCCD giống hồ sơ khách, đúng như
        // luồng thật khi bấm "Điền theo khách hàng".
        beneficiaryIdNumber: c.idNumber ?? "",
        beneficiaryPhone: `09${String(10_000_000 + i * 100 + n).slice(-8)}`,
        beneficiaryAddress: DEMO_ADDRESS,
        handledBy: handler?.id ?? null,
        handledByDepartmentId: handler?.deptId ?? null,
        licensePlate: n % 2 === 0 ? `59X1-${i}${n}` : "",
        vehicleType: n % 2 === 0 ? "1001" : "",
        // Đơn tai nạn điện để 0 thì bot PVI dừng ở hai ô này — bộ mẫu phải đi
        // được trọn luồng, không thì ca "bot chạy trơn" không thử được.
        householdSize: n % 2 === 0 ? 0 : 3 + (n % 3),
        sumInsured: n % 2 === 0 ? 0 : n % 4 === 1 ? 40_000_000 : 80_000_000,
        createdBy: ownerId,
        createdByDepartmentId: deptId,
      });
    }

    for (let n = 0; n < (c.services ?? 0); n++) {
      await db.insert(services).values({
        customerId: customer.id,
        serviceTypeId: serviceTypeRows[n % serviceTypeRows.length].id,
        serviceDate: day(7 + n),
        note: "",
        createdBy: ownerId,
        createdByDepartmentId: deptId,
      });
    }
  }

  /* Khách độn — đủ hai trang ở P-40 mà không lẫn vào các ca trên. */
  const fillerOwner = userIdByName.get("demo_kd2_a")!;
  const fillerDept = deptIdByCode.get(STAFF.find((s) => s.username === "demo_kd2_a")!.dept)!;
  for (let i = 0; i < FILLER_COUNT; i++) {
    const [row] = await db
      .insert(customers)
      .values({
        fullName: `Khách độn ${i + 1}`,
        address: DEMO_ADDRESS,
        createdBy: fillerOwner,
        createdByDepartmentId: fillerDept,
      })
      .returning({ id: customers.id });
    await db.insert(customerPhones).values({
      customerId: row.id,
      number: `0913${String(200000 + i).padStart(6, "0")}`,
      isPrimary: true,
    });
  }
  touchedOwners.add(fillerOwner);

  /* Điểm KPI và trường hợp quà KHÔNG tự sinh khi ghi thẳng vào bảng — đường
     tính lại nằm ở tầng ứng dụng, mà script này đi tắt xuống database. */
  for (const id of touchedCustomers) await recomputeGiftCase(id);
  for (const ownerId of touchedOwners) await recomputeKpi(ownerId, MONTH);

  /* Một đợt quà ĐÃ CHỐT, dựng sau khi có `gift_case` để snapshot đúng thật. */
  const gifted = CUSTOMERS.findIndex((c) => c.gifted);
  if (gifted >= 0) {
    const customerId = touchedCustomers[gifted];
    const snapshot = await giftForCustomer(customerId);
    await db.insert(giftGrants).values({
      customerId,
      grantedBy: userIdByName.get(CUSTOMERS[gifted].owner)!,
      cashTotal: snapshot.cashTotal,
      chosenItem: snapshot.basket[0]?.code ?? "DECLINED",
      snapshot,
    });
  }

  console.log(
    `Dựng xong (ngày ${businessDay()}): ${STAFF.length} nhân viên · ` +
      `${CUSTOMERS.length} khách theo ca + ${FILLER_COUNT} khách độn · ` +
      `mật khẩu tất cả là "${PASSWORD}".`,
  );
  // Nói ra vì nó làm cả bảng KPI đỏ và trông như lỗi: chỉ tiêu mặc định 100
  // điểm là của thang CŨ, thang mới trần 1.2 điểm mỗi khách (thể lệ câu 7.12).
  console.log(
    "⚠️ Chỉ tiêu KPI đang là 100 điểm/tháng — thang mới nhỏ hơn nhiều nên mọi " +
      "nhân viên sẽ hiện “chưa đạt”. Đặt lại ở màn Chỉ tiêu KPI (P-83).",
  );
}

async function main() {
  await clean();
  if (process.argv.includes("--clean")) return;
  await build();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
