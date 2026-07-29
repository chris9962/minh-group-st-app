import type {
  PersonAccount,
  PersonDetail,
  PersonService,
  PointSource,
} from "@/lib/api/person";
import { removeDiacritics } from "@/lib/format";
import { ALL, seed } from "./people";

/** Dữ liệu giả cho P-52. Dựng từ cùng danh sách người của P-51 để hai màn khớp nhau. */

const BANKS = ["MSBa", "VPa", "VPb", "MB", "TPB"];
const BANK_FACTOR: Record<string, number> = { MSBa: 3, VPa: 2, VPb: 2, MB: 1, TPB: 1 };
const CHANNELS = ["Ấp Tân Hoà", "BV Tân An", "ATM", "Định danh", "Ấp Tân Lập"];
const SERVICE_TYPES = [
  "Thanh toán hoá đơn",
  "Nạp / rút",
  "Thủ tục hành chính",
  "Bảo hiểm xã hội",
  "Bảo hiểm y tế",
];
const WARDS = ["Tân Bình", "Tân Hoà", "Tân Lập", "Tân Phú"];
const CUSTOMERS = [
  "Nguyễn Thị Bích Trâm",
  "Trần Văn Đức",
  "Lê Thị Hồng",
  "Phạm Minh Tuấn",
  "Võ Thị Mai",
  "Đỗ Văn Bình",
  "Huỳnh Thị Ngọc",
  "Lý Văn Sang",
];

/** Tên đăng nhập giả: chữ cuối của tên, bỏ dấu. Bản thật lấy từ hồ sơ. */
const usernameOf = (fullName: string): string =>
  removeDiacritics(fullName).toLowerCase().split(" ").slice(-2).join("");

const phoneOf = (fullName: string): string =>
  `09${String(seed(fullName, 7) * 1013 + 100000).slice(0, 8)}`;

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

function accountsOf(fullName: string, month: string, count: number): PersonAccount[] {
  return Array.from({ length: count }, (_, i) => {
    const bank = BANKS[seed(fullName, i + 11) % BANKS.length];
    return {
      id: `a${i + 1}`,
      date: dayIn(month, i),
      customerName: CUSTOMERS[seed(fullName, i + 23) % CUSTOMERS.length],
      bankName: bank,
      referralCode: `${bank}-${String(seed(fullName, i + 31) * 7).padStart(4, "0").slice(0, 4)}`,
      channel: CHANNELS[seed(fullName, i + 41) % CHANNELS.length],
      // App chưa cài thì tài khoản không tính điểm, không tính quà — cột này
      // là lý do bảng có dòng nhưng điểm vẫn thấp.
      appInstalled: seed(fullName, i + 53) % 5 !== 0,
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

/** Gom tài khoản theo ngân hàng để giải thích điểm đến từ đâu. */
function pointSourcesOf(
  accounts: PersonAccount[],
  insuranceOrders: number,
): PointSource[] {
  const byBank = new Map<string, number>();
  for (const a of accounts) {
    if (!a.appInstalled) continue;
    byBank.set(a.bankName, (byBank.get(a.bankName) ?? 0) + 1);
  }

  const sources: PointSource[] = [...byBank.entries()]
    .map(([bank, count]) => ({
      label: bank,
      detail: `${count} tài khoản · hệ số ${BANK_FACTOR[bank] ?? 1}`,
      points: count * (BANK_FACTOR[bank] ?? 1),
    }))
    .sort((a, b) => b.points - a.points);

  if (insuranceOrders > 0) {
    sources.push({
      label: "Đơn bảo hiểm",
      detail: `${insuranceOrders} đơn`,
      points: insuranceOrders,
    });
  }

  return sources;
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

  const accounts = accountsOf(base.fullName, summaryMonth, accountCount);
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
    pointSources: pointSourcesOf(
      accountsOf(base.fullName, summaryMonth, base.accounts),
      base.insuranceOrders,
    ),
    accounts,
    services,
  };
}
