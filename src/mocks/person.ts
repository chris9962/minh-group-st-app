import type {
  CustomerGift,
  PersonAccount,
  PersonDetail,
  PersonInsurance,
  PersonService,
  PointSource,
} from "@/lib/api/person";
import { removeDiacritics } from "@/lib/format";
import {
  accountCountOf,
  BANK_FACTOR,
  buildAccounts,
  CUSTOMERS,
  seed,
  type AccountSpec,
} from "./activity";
import { ALL } from "./people";

/** Dữ liệu giả cho P-52. Dựng từ cùng danh sách người của P-51 để hai màn khớp nhau. */

const SERVICE_TYPES = [
  "Thanh toán hoá đơn",
  "Nạp / rút",
  "Thủ tục hành chính",
  "Bảo hiểm xã hội",
  "Bảo hiểm y tế",
];
const WARDS = ["Tân Bình", "Tân Hoà", "Tân Lập", "Tân Phú"];

/** Tên đăng nhập giả: chữ cuối của tên, bỏ dấu. Bản thật lấy từ hồ sơ. */
const usernameOf = (fullName: string): string =>
  removeDiacritics(fullName).toLowerCase().split(" ").slice(-2).join("");

/** SĐT giả phải đủ 10 số, nếu không formatPhone trả lại nguyên chuỗi thô. */
const phoneOf = (fullName: string): string =>
  `09${String(seed(fullName, 7) * 1013 + 10_000_000).slice(0, 8)}`;

/** Ngày trong tháng, đếm ngược từ ngày cuối cùng có hoạt động. */
function dayIn(month: string, offset: number): string {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && mon === now.getMonth() + 1;
  const from = isCurrentMonth ? now.getDate() : lastDay;
  const day = Math.max(1, from - offset);
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Gắn ngày vào danh sách tài khoản dùng chung; thứ tự mới nhất trước. */
const accountsOf = (fullName: string, month: string, count: number): PersonAccount[] =>
  buildAccounts(fullName, count).map((a: AccountSpec, i) => ({
    ...a,
    date: dayIn(month, i),
  }));

const PRODUCTS: [string, string][] = [
  ["BH tai nạn điện", "1 năm · 100k"],
  ["BH tai nạn điện", "1 năm · 200k"],
  ["BH xe máy", "1 năm · 100k"],
  ["BH xe máy", "2 năm · 200k"],
];
const STATUSES: PersonInsurance["status"][] = ["done", "done", "running", "manual"];

function insuranceOf(fullName: string, month: string, count: number): PersonInsurance[] {
  return Array.from({ length: count }, (_, i) => {
    const [product, packageName] = PRODUCTS[seed(fullName, i + 83) % PRODUCTS.length];
    return {
      id: `i${i + 1}`,
      date: dayIn(month, i * 3),
      customerName: CUSTOMERS[seed(fullName, i + 89) % CUSTOMERS.length],
      product,
      packageName,
      status: STATUSES[seed(fullName, i + 97) % STATUSES.length],
    };
  });
}

function servicesOf(fullName: string, month: string, count: number): PersonService[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`,
    date: dayIn(month, i * 2),
    customerName: CUSTOMERS[seed(fullName, i + 67) % CUSTOMERS.length],
    serviceType: SERVICE_TYPES[seed(fullName, i + 71) % SERVICE_TYPES.length],
    ward: WARDS[seed(fullName, i + 79) % WARDS.length],
    points: 1,
  }));
}

/** Rổ quà — mỗi khách đủ điều kiện nhận TIỀN MẶT cộng thêm một món. */
const GIFT_CASH = "Tiền mặt 20.000đ";
const GIFT_ITEMS = ["Nón bảo hiểm", "Mì", "Loa", "1 năm BH xe máy", "BH sức khoẻ"];

/**
 * Quà tính theo KHÁCH chứ không theo từng tài khoản: khách cài đủ 2 app trở
 * lên mới vào diện. Một phần đã phát, phần còn lại là "đủ ĐK · chưa phát" —
 * đúng con số mà dashboard đang đếm.
 */
function giftsOf(accounts: PersonAccount[]): CustomerGift[] {
  const appsPerCustomer = new Map<string, number>();
  for (const a of accounts) {
    if (!a.appInstalled) continue;
    appsPerCustomer.set(a.customerName, (appsPerCustomer.get(a.customerName) ?? 0) + 1);
  }

  return [...appsPerCustomer.entries()]
    .filter(([, apps]) => apps >= 2)
    .map(([customerName, apps], i) => ({
      customerName,
      eligible: true,
      items: i % 3 === 0 ? [] : [GIFT_CASH, GIFT_ITEMS[(apps + i) % GIFT_ITEMS.length]],
    }));
}

/**
 * Tách điểm theo nguồn.
 *
 * Tổng của danh sách này PHẢI bằng đúng tổng điểm hiện ở giữa vòng, nên chỉ
 * gồm những thứ thật sự sinh điểm: app đã cài theo từng ngân hàng, và dịch vụ.
 * Đơn bảo hiểm cố ý không có mặt — theo spec nó không tính vào điểm KPI.
 */
function pointSourcesOf(
  accounts: PersonAccount[],
  servicePoints: number,
): PointSource[] {
  const byBank = new Map<string, number>();
  for (const a of accounts) {
    if (!a.appInstalled) continue;
    byBank.set(a.bankName, (byBank.get(a.bankName) ?? 0) + 1);
  }

  const sources: PointSource[] = [...byBank.entries()]
    .map(([bank, count]) => ({
      label: bank,
      detail: `${count} app đã cài · hệ số ${BANK_FACTOR[bank] ?? 1}`,
      points: count * (BANK_FACTOR[bank] ?? 1),
    }))
    .sort((a, b) => b.points - a.points);

  if (servicePoints > 0) {
    sources.push({
      label: "Dịch vụ",
      detail: `${servicePoints} lượt`,
      points: servicePoints,
    });
  }

  return sources;
}

/** Điểm 5 tháng gần nhất; tháng đang xem là tháng cuối và lấy đúng số thật. */
function monthlyPointsOf(fullName: string, month: string, current: number) {
  const [year, mon] = month.split("-").map(Number);
  return Array.from({ length: 5 }, (_, i) => {
    const offset = 4 - i;
    const d = new Date(year, mon - 1 - offset, 1);
    return {
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      points: offset === 0 ? current : 45 + (seed(fullName, offset + 101) % 70),
    };
  });
}

export function personFor({
  id,
  period,
  summaryMonth,
}: {
  id: string;
  period: string;
  summaryMonth: string;
}): PersonDetail | null {
  const base = ALL.find((p) => p.id === id);
  if (!base) return null;

  const daily = period === "today";
  // Một ngày thì chỉ vài dòng; cả tháng thì bằng số tài khoản đã mở.
  const accountCount = daily ? Math.max(0, Math.round(base.accounts / 22)) : base.accounts;
  const serviceCount = daily
    ? Math.max(0, Math.round(base.servicePoints / 22))
    : base.servicePoints;

  const insuranceCount = daily
    ? Math.max(0, Math.round(base.insuranceOrders / 22))
    : base.insuranceOrders;

  const accounts = accountsOf(base.fullName, summaryMonth, accountCount);
  const insurance = insuranceOf(base.fullName, summaryMonth, insuranceCount);
  const services = servicesOf(base.fullName, summaryMonth, serviceCount);

  const lastDay = new Date(
    Number(summaryMonth.slice(0, 4)),
    Number(summaryMonth.slice(5, 7)),
    0,
  ).getDate();
  const now = new Date();
  const isCurrentMonth =
    summaryMonth ===
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const total = base.bankingPoints + base.servicePoints;

  return {
    id: base.id,
    fullName: base.fullName,
    username: usernameOf(base.fullName),
    phone: phoneOf(base.fullName),
    departmentName: base.departmentName,
    joinedMonth: "2024-03",
    summaryMonth,
    daysLeft: isCurrentMonth ? Math.max(0, lastDay - now.getDate()) : 0,
    // Điểm LUÔN của cả tháng, kể cả khi bảng đang xem theo ngày — chỉ tiêu là
    // chỉ tiêu tháng, không có "chỉ tiêu hôm nay".
    points: {
      banking: base.bankingPoints,
      service: base.servicePoints,
      total: base.bankingPoints + base.servicePoints,
      target: base.target,
    },
    // Tách điểm luôn tính trên tài khoản CẢ THÁNG, khớp với con số ở giữa vòng.
    pointSources: pointSourcesOf(
      accountsOf(base.fullName, summaryMonth, accountCountOf(base.fullName)),
      base.servicePoints,
    ),
    monthlyPoints: monthlyPointsOf(base.fullName, summaryMonth, total),
    gifts: giftsOf(accounts),
    accounts,
    insurance,
    services,
  };
}
