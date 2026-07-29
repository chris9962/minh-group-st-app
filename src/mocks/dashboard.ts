import type { DashboardData } from "@/lib/api/dashboard";
import type { Scope } from "@/lib/types";

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
    codesRunningLow: 2,
    giftsPending: 18,
  },
  insurance: {
    createdToday: 24,
    fireCount: 9,
    motorbikeCount: 15,
    completed: 17,
    completedPercent: 71,
    pending: 7,
    pendingBot: 3,
    pendingManual: 4,
    avgMinutes: 6,
    avgSeconds: 12,
    byHour: [
      { label: "8–10h", automatic: 4, manual: 1 },
      { label: "10–12h", automatic: 7, manual: 1 },
      { label: "12–14h", automatic: 2, manual: 0 },
      { label: "14–16h", automatic: 6, manual: 2 },
      { label: "16–18h", automatic: 3, manual: 1 },
      { label: "sau 18h", automatic: 1, manual: 0 },
    ],
  },
  quality: {
    botSuccessPercent: 88,
    botAvgMinutes: 4,
    botAvgSeconds: 2,
    manualOrders: 19,
    badInputOrders: 6,
    overnightOrders: 3,
  },
  services: {
    byType: [
      { label: "Nạp / rút", count: 34 },
      { label: "BHYT", count: 21 },
      { label: "Thủ tục hành chính", count: 12 },
      { label: "Thanh toán hoá đơn", count: 9 },
    ],
    topWard: { name: "Tân Bình", count: 29 },
  },
};

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
  if (r === 1) return COMPANY;

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
      codesRunningLow: d.banking.codesRunningLow,
      giftsPending: scale(d.banking.giftsPending, r),
    },
    insurance: {
      ...d.insurance,
      createdToday: scale(d.insurance.createdToday, r),
      fireCount: scale(d.insurance.fireCount, r),
      motorbikeCount: scale(d.insurance.motorbikeCount, r),
      completed: scale(d.insurance.completed, r),
      // Đơn tồn là số tức thời, chỉ co theo phạm vi chứ không theo kỳ.
      pending: scale(d.insurance.pending, RATIO[scope] ?? 1),
      pendingBot: scale(d.insurance.pendingBot, RATIO[scope] ?? 1),
      pendingManual: scale(d.insurance.pendingManual, RATIO[scope] ?? 1),
      byHour: d.insurance.byHour.map((h) => ({
        label: h.label,
        automatic: scale(h.automatic, r),
        manual: scale(h.manual, r),
      })),
    },
    quality: {
      ...d.quality,
      manualOrders: scale(d.quality.manualOrders, r),
      badInputOrders: scale(d.quality.badInputOrders, r),
      overnightOrders: scale(d.quality.overnightOrders, r),
    },
    services: {
      byType: d.services.byType.map((s) => ({
        label: s.label,
        count: scale(s.count, r),
      })),
      topWard: { ...d.services.topWard, count: scale(d.services.topWard.count, r) },
    },
  };
}
