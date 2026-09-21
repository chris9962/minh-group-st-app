/**
 * Ca thử ô tìm trên thanh trên: nhảy tới màn sidebar, cộng hành động đã có
 * sẵn trên app, cộng bản ghi tìm được (khách, phòng, dịch vụ, mã).
 */
import { User } from "../src/lib/types";
import {
  FEEDBACK_HREF,
  filterJumpTargets,
  jumpActionsFor,
  jumpTargetsFrom,
  type NavEntry,
} from "../src/lib/nav";
import {
  jumpHitsFromBanking,
  jumpHitsFromCustomers,
  jumpHitsFromDepartments,
  jumpHitsFromInsurance,
  jumpHitsFromServices,
  jumpHitsFromStaff,
  jumpSourcesFor,
  shouldSearchRecords,
} from "../src/lib/jump-search";

type Value = number | boolean | string | null;

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: Value, expected: Value): void {
  if (Object.is(actual, expected)) {
    passed += 1;
    return;
  }
  failures.push(`${name}\n      mong ${expected} · nhận ${actual}`);
}

const entries: NavEntry[] = [
  { href: "/", label: "Tổng quan", icon: "overview", screen: "P-80" },
  { href: "/insurance", label: "Bảo hiểm", icon: "insurance", screen: "P-13" },
  { href: "/customers", label: "Khách hàng", icon: "customers", screen: "P-40" },
  {
    href: "/gifts",
    label: "Quà đã phát",
    icon: "gift",
    screen: "P-44",
    hidden: true,
  },
  {
    label: "Cấu hình",
    icon: "settings",
    children: [
      { href: "/settings/banks", label: "Ngân hàng & mã giới thiệu", screen: "P-60" },
      { href: "/settings/channels", label: "Danh mục kênh", screen: "P-70" },
    ],
  },
];

const targets = jumpTargetsFrom(entries);
const hrefs = targets.map((t) => t.href).join(",");

check("có Tổng quan", hrefs.includes("/"), true);
check("có Bảo hiểm", hrefs.includes("/insurance"), true);
check("có Khách hàng", hrefs.includes("/customers"), true);
check("không bày màn hidden", hrefs.includes("/gifts"), false);
check("nhóm mở thành mục con", hrefs.includes("/settings/banks"), true);
check(
  "mục con mang tên nhóm",
  targets.find((t) => t.href === "/settings/channels")?.group ?? null,
  "Cấu hình",
);
check("màn gốc không có nhóm", targets.find((t) => t.href === "/insurance")?.group ?? null, null);

const all = filterJumpTargets(targets, "  ");
check("ô trống trả đúng các màn sidebar", all.length, targets.length);

const bao = filterJumpTargets(targets, "bao");
check("lọc không dấu ra Bảo hiểm", bao.length, 1);
check("lọc không dấu đúng href", bao[0]?.href ?? "", "/insurance");

const cau = filterJumpTargets(targets, "cau hinh");
check("lọc theo tên nhóm ra đủ mục con", cau.length, 2);

const none = filterJumpTargets(targets, "xyz-khong-co");
check("không bịa kết quả", none.length, 0);

function person(over: Record<string, unknown> = {}) {
  return User.parse({
    id: "u",
    username: "u",
    fullName: "U",
    role: "staff",
    departmentId: null,
    managedDepartmentIds: [],
    managedBankIds: [],
    manageScope: "none",
    title: "",
    permissions: [],
    active: true,
    ...over,
  });
}

const nobody = jumpActionsFor(null);
check("chưa đăng nhập không có hành động", nobody.length, 0);

const bare = jumpActionsFor(person());
const bareHrefs = bare.map((a) => a.href).join(",");
check("ai cũng có hồ sơ", bareHrefs.includes("/profile"), true);
check("ai cũng có thông báo", bareHrefs.includes("/notifications"), true);
check("ai cũng có góp ý", bareHrefs.includes(FEEDBACK_HREF), true);
check("không quyền thì không thêm khách", bareHrefs.includes("/customers"), false);
check("không quyền thì không lập đơn", bareHrefs.includes("/insurance"), false);
check("không quyền thì không thêm phòng", bareHrefs.includes("/departments"), false);
check("góp ý không phải đường trang", bare.find((a) => a.label === "Góp ý")?.href ?? "", FEEDBACK_HREF);
check("nhãn hồ sơ khớp menu tài khoản", bare.find((a) => a.href === "/profile")?.label ?? "", "Thông tin cá nhân");

const staffCreate = jumpActionsFor(
  person({
    permissions: [
      { module: "customer", action: "create", scope: "own" },
      { module: "banking", action: "create", scope: "own" },
      { module: "insurance", action: "create", scope: "own" },
      { module: "services", action: "create", scope: "own" },
      { module: "staff", action: "create", scope: "own" },
    ],
  }),
);
const staffHrefs = staffCreate.map((a) => a.href).join(",");
check("thêm khách khi có quyền", staffHrefs.includes("/customers?create=1"), true);
check("tạo TK khi có quyền", staffHrefs.includes("/banking?create=1"), true);
check("ghi dịch vụ khi có quyền", staffHrefs.includes("/services?create=1"), true);
check("thêm NV khi có quyền", staffHrefs.includes("/users?create=1"), true);
check("nhân viên không lập đơn dù có create", staffHrefs.includes("/insurance"), false);
check(
  "nhãn thêm khách khớp nút",
  staffCreate.find((a) => a.href === "/customers?create=1")?.label ?? "",
  "Thêm khách hàng",
);

const director = jumpActionsFor(
  person({
    role: "director",
    permissions: [{ module: "insurance", action: "create", scope: "company" }],
  }),
);
check(
  "giám đốc lập đơn khi có create",
  director.some((a) => a.href === "/insurance?create=1"),
  true,
);
check(
  "nhãn lập đơn khớp nút",
  director.find((a) => a.href === "/insurance?create=1")?.label ?? "",
  "Lập đơn",
);

const org = jumpActionsFor(
  person({
    permissions: [{ module: "department", action: "create", scope: "company" }],
  }),
);
check("thêm phòng khi canOrg create", org.some((a) => a.href === "/departments?create=1"), true);

const catalog = jumpActionsFor(
  person({
    permissions: [
      { module: "system", action: "send-announcement", scope: "company" },
      { module: "system", action: "manage-bank", scope: "company" },
      { module: "system", action: "configure-catalog", scope: "company" },
    ],
  }),
);
const catalogHrefs = catalog.map((a) => a.href).join(",");
check("thông báo chung khi có quyền gửi", catalogHrefs.includes("/notifications?create=1"), true);
check("thêm ngân hàng khi manage-bank", catalogHrefs.includes("/settings/banks?create=bank"), true);
check(
  "thêm mã khi mở được P-60",
  catalogHrefs.includes("/settings/banks?tab=codes&create=code"),
  true,
);
check(
  "thêm loại dịch vụ khi configure-catalog",
  catalogHrefs.includes("/settings/service-types?create=1"),
  true,
);

const assignedOnly = jumpActionsFor(
  person({
    permissions: [{ module: "system", action: "manage-assigned-banks", scope: "company" }],
  }),
);
check(
  "ngân hàng được giao không thêm ngân hàng mới",
  assignedOnly.some((a) => a.href === "/settings/banks?create=bank"),
  false,
);
check(
  "ngân hàng được giao vẫn thêm mã",
  assignedOnly.some((a) => a.href === "/settings/banks?tab=codes&create=code"),
  true,
);

const themKhach = filterJumpTargets(staffCreate, "them khach");
check("lọc hành động không dấu", themKhach.length, 1);
check("lọc hành động đúng href", themKhach[0]?.href ?? "", "/customers?create=1");

check("ô trống không tra kho", shouldSearchRecords("  "), false);
check("một chữ không tra kho", shouldSearchRecords("a"), false);
check("hai chữ thì tra", shouldSearchRecords("an"), true);
check("ba số thì tra", shouldSearchRecords("090"), true);

check("chưa đăng nhập không tra kho", jumpSourcesFor(null).join(","), "");
check("ai cũng tra khách", jumpSourcesFor(person()).includes("customers"), true);
check("không quyền thì không tra ngân hàng", jumpSourcesFor(person()).includes("banking"), false);

const viewer = jumpSourcesFor(
  person({
    manageScope: "company",
    permissions: [
      { module: "banking", action: "view-detail", scope: "company" },
      { module: "insurance", action: "view-detail", scope: "company" },
      { module: "services", action: "view-detail", scope: "company" },
      { module: "department", action: "view-detail", scope: "company" },
      { module: "staff", action: "view-detail", scope: "company" },
    ],
  }),
);
check("có quyền thì tra ngân hàng", viewer.includes("banking"), true);
check("có quyền thì tra bảo hiểm", viewer.includes("insurance"), true);
check("có quyền thì tra dịch vụ", viewer.includes("services"), true);
check("có quyền thì tra phòng", viewer.includes("departments"), true);
check("có quyền thì tra nhân sự", viewer.includes("staff"), true);

const customers = jumpHitsFromCustomers([
  { id: "c1", fullName: "Nguyễn Văn An", primaryPhone: "0901234567", seq: 1, rootId: "c1" },
]);
check("khách ra đúng đường", customers[0]?.href ?? "", "/customers/c1");
check("khách mang nhóm Khách hàng", customers[0]?.group ?? "", "Khách hàng");

const banks = jumpHitsFromBanking([
  {
    id: "b1",
    customerName: "Nguyễn Văn An",
    bankCode: "VPa",
    accountNumber: "0123456789",
    referralCodeText: "VP123",
  },
]);
check("tài khoản ra đúng đường", banks[0]?.href ?? "", "/banking/b1");
check("tài khoản hiện số TK", banks[0]?.detail?.includes("0123456789") ?? false, true);

const orders = jumpHitsFromInsurance([
  { id: "i1", customerName: "Nguyễn Văn An", orderCode: "DH-2609-001" },
]);
check("đơn ra đúng đường", orders[0]?.href ?? "", "/insurance/i1");
check("đơn hiện mã", orders[0]?.detail ?? "", "DH-2609-001");

const services = jumpHitsFromServices([
  {
    id: "s1",
    customerId: "c1",
    customerName: "Nguyễn Văn An",
    serviceTypeName: "Rút tiền",
  },
]);
check("dịch vụ không có màn riêng — vào hồ sơ khách", services[0]?.href ?? "", "/customers/c1");
check("dịch vụ mang nhóm Dịch vụ", services[0]?.group ?? "", "Dịch vụ");

const rooms = jumpHitsFromDepartments([{ id: "d1", name: "Phòng Kinh doanh 1" }]);
check("phòng ra đúng đường", rooms[0]?.href ?? "", "/departments/d1");

const people = jumpHitsFromStaff([
  { id: "u1", fullName: "Trần Thị Bích", staffCode: "NV001", title: "Nhân viên kinh doanh" },
]);
check("nhân sự ra đúng đường", people[0]?.href ?? "", "/users/u1");
check("nhân sự hiện mã", people[0]?.detail ?? "", "NV001");

if (failures.length > 0) {
  console.error(`\n${failures.length} ca sai:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log(`\n  ${passed} ca đạt\n`);
