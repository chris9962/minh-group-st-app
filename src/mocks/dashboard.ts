import type { DashboardData } from "@/lib/api/dashboard";
import type { Scope } from "@/lib/types";
import { departments as allDepartments } from "./data";

/** Số liệu giả cho P-80. Lấy đúng con số trong bản thiết kế ở phạm vi toàn công ty. */

const COMPANY: DashboardData = {
  installRate: {
    percent: 82,
    appsInstalled: 50,
    accountsOpened: 61,
    previousPercent: 76,
  },
  banking: {
    accountsOpened: 61,
    appsInstalled: 50,
    customers: 47,
    giftsPending: 18,
  },
  insurance: {
    createdToday: 24,
    electricCount: 9,
    motorbikeCount: 15,
    completed: 17,
    completedPercent: 71,
    pending: 7,
    pendingBot: 3,
    pendingManual: 4,
    bucketType: "hour",
    buckets: [],
  },
  departments: [],
  services: {
    byType: [
      { label: "Nạp / rút", count: 34 },
      { label: "BHYT", count: 21 },
      { label: "Thủ tục hành chính", count: 12 },
      { label: "Thanh toán hoá đơn", count: 9 },
    ],
    topWard: { name: "Tân Bình", count: 29 },
  },
  gifts: {
    byType: [
      { label: "Tiền mặt 20.000đ", count: 26 },
      { label: "1 năm BH xe máy", count: 19 },
      { label: "Tiền mặt 50.000đ", count: 14 },
      { label: "1 năm BH tai nạn điện 100k", count: 11 },
      { label: "Nón bảo hiểm", count: 8 },
      { label: "2 năm BH xe máy", count: 6 },
      { label: "Mì", count: 5 },
      { label: "Loa", count: 3 },
    ],
    pending: 18,
  },
};



/* ── Xếp hạng phòng ─────────────────────────────────────────────────── */

/** Chỉ 9 phòng kinh doanh mới mở tài khoản; các phòng khác không có số. */
const SALES_DEPARTMENTS = allDepartments.filter((d) => d.id.startsWith("kd-"));

/** Con số cố định theo id để bảng không nhảy mỗi lần render. */
const seed = (id: string, salt: number) =>
  ((id.charCodeAt(id.length - 1) * 31 + salt * 17) % 23) + 4;

function departmentRanking(ratio: number) {
  return SALES_DEPARTMENTS.map((d) => {
    const accountsOpened = scale(seed(d.id, 1) * 6, ratio);
    // Tỉ lệ cài dao động 52–95% để thấy rõ phòng nhiều tài khoản mà cài ít.
    const rate = 0.52 + (seed(d.id, 2) % 44) / 100;
    return {
      id: d.id,
      name: d.name,
      accountsOpened,
      appsInstalled: Math.round(accountsOpened * rate),
      customers: Math.round(accountsOpened * 0.78),
    };
  });
}

/* ── Cột biểu đồ: độ chia theo kỳ ───────────────────────────────────── */

type Bucket = { label: string; automatic: number; manual: number };

const HOUR_SHAPE = [
  { label: "8–10h", automatic: 4, manual: 1 },
  { label: "10–12h", automatic: 7, manual: 1 },
  { label: "12–14h", automatic: 2, manual: 0 },
  { label: "14–16h", automatic: 6, manual: 2 },
  { label: "16–18h", automatic: 3, manual: 1 },
  { label: "sau 18h", automatic: 1, manual: 0 },
];

const dd = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Dao động nhẹ và ổn định theo chỉ số, để cột không phẳng lì mà cũng không nhảy mỗi lần render. */
const wiggle = (i: number) => 0.6 + ((i * 37) % 11) / 10;

function rangeOf(periodKey: string): { from: Date; to: Date } {
  const to = new Date();
  if (periodKey === "this-month") {
    return { from: new Date(to.getFullYear(), to.getMonth(), 1), to };
  }
  if (periodKey.startsWith("range:")) {
    const [, from, until] = periodKey.split(":");
    return { from: new Date(from), to: new Date(until) };
  }
  return { from: to, to };
}

function makeBuckets(
  periodKey: string,
  scale_: (n: number, r: number) => number,
  ratio: number,
): { bucketType: "hour" | "day" | "week" | "month"; buckets: Bucket[] } {
  if (periodKey === "today") {
    return {
      bucketType: "hour",
      buckets: HOUR_SHAPE.map((h) => ({
        label: h.label,
        automatic: scale_(h.automatic, ratio),
        manual: scale_(h.manual, ratio),
      })),
    };
  }

  const { from, to } = rangeOf(periodKey);
  const days = Math.max(
    1,
    Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1,
  );

  // Quá nhiều cột thì không đọc được — gộp thành tuần rồi tháng.
  const step = days <= 31 ? 1 : days <= 182 ? 7 : 30;
  const bucketType = step === 1 ? "day" : step === 7 ? "week" : "month";

  const buckets: Bucket[] = [];
  for (let i = 0; i < days; i += step) {
    const start = new Date(from.getTime() + i * 86_400_000);
    const end = new Date(
      Math.min(to.getTime(), start.getTime() + (step - 1) * 86_400_000),
    );
    buckets.push({
      label: step === 1 ? dd(start) : `${dd(start)}–${dd(end)}`,
      automatic: scale_(Math.round(4 * step * wiggle(i)), ratio),
      manual: scale_(Math.round(step * wiggle(i + 3)) || 1, ratio),
    });
  }

  return { bucketType, buckets };
}

/** Phạm vi hẹp hơn thì số nhỏ lại — để thấy rõ thanh chọn phạm vi có tác dụng. */
const RATIO: Record<Scope, number> = {
  own: 0.08,
  managed: 0.35,
  company: 1,
};

const scale = (value: number, ratio: number) =>
  ratio === 1 ? value : Math.max(0, Math.round(value * ratio));

/** Kỳ dài hơn thì số lớn lên. Ước lượng thô, chỉ để thấy bộ chọn kỳ có tác dụng. */
function periodFactor(periodKey: string): number {
  if (periodKey === "this-month") return 21;
  if (periodKey.startsWith("range:")) {
    const [, from, to] = periodKey.split(":");
    const days =
      Math.abs(new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1;
    return Number.isFinite(days) ? Math.max(1, Math.round(days)) : 1;
  }
  return 1;
}

export function dashboardFor(scope: Scope, periodKey = "today"): DashboardData {
  const r = (RATIO[scope] ?? 1) * periodFactor(periodKey);
  const chart = makeBuckets(periodKey, scale, RATIO[scope] ?? 1);

  if (r === 1) {
    return {
      ...COMPANY,
      insurance: { ...COMPANY.insurance, ...chart },
      departments: departmentRanking(1),
    };
  }

  const d = COMPANY;
  return {
    // Tỉ lệ phần trăm KHÔNG nhân theo phạm vi — nó là tỉ lệ, không phải số đếm.
    installRate: {
      ...d.installRate,
      appsInstalled: scale(d.installRate.appsInstalled, r),
      accountsOpened: scale(d.installRate.accountsOpened, r),
    },
    banking: {
      accountsOpened: scale(d.banking.accountsOpened, r),
      appsInstalled: scale(d.banking.appsInstalled, r),
      customers: scale(d.banking.customers, r),
      giftsPending: scale(d.banking.giftsPending, r),
    },
    insurance: {
      ...d.insurance,
      createdToday: scale(d.insurance.createdToday, r),
      electricCount: scale(d.insurance.electricCount, r),
      motorbikeCount: scale(d.insurance.motorbikeCount, r),
      completed: scale(d.insurance.completed, r),
      // Đơn tồn là số tức thời, chỉ co theo phạm vi chứ không theo kỳ.
      pending: scale(d.insurance.pending, RATIO[scope] ?? 1),
      pendingBot: scale(d.insurance.pendingBot, RATIO[scope] ?? 1),
      pendingManual: scale(d.insurance.pendingManual, RATIO[scope] ?? 1),
      ...chart,
    },
    departments: departmentRanking(r),
    services: {
      byType: d.services.byType.map((s) => ({
        label: s.label,
        count: scale(s.count, r),
      })),
      topWard: { ...d.services.topWard, count: scale(d.services.topWard.count, r) },
    },
    gifts: {
      byType: d.gifts.byType.map((g) => ({
        label: g.label,
        count: scale(g.count, r),
      })),
      pending: scale(d.gifts.pending, r),
    },
  };
}
