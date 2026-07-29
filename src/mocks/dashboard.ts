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

const scaleDown = (value: number, ratio: number) =>
  ratio === 1 ? value : Math.max(0, Math.round(value * ratio));

export function dashboardFor(scope: Scope): DashboardData {
  const r = RATIO[scope] ?? 1;
  if (r === 1) return COMPANY;

  const d = COMPANY;
  return {
    // Tỉ lệ phần trăm KHÔNG nhân theo phạm vi — nó là tỉ lệ, không phải số đếm.
    installRate: {
      ...d.installRate,
      appsInstalled: scaleDown(d.installRate.appsInstalled, r),
      accountsOpened: scaleDown(d.installRate.accountsOpened, r),
    },
    banking: {
      accountsOpened: scaleDown(d.banking.accountsOpened, r),
      appsInstalled: scaleDown(d.banking.appsInstalled, r),
      codesRunningLow: d.banking.codesRunningLow,
      giftsPending: scaleDown(d.banking.giftsPending, r),
    },
    insurance: {
      ...d.insurance,
      createdToday: scaleDown(d.insurance.createdToday, r),
      fireCount: scaleDown(d.insurance.fireCount, r),
      motorbikeCount: scaleDown(d.insurance.motorbikeCount, r),
      completed: scaleDown(d.insurance.completed, r),
      pending: scaleDown(d.insurance.pending, r),
      pendingBot: scaleDown(d.insurance.pendingBot, r),
      pendingManual: scaleDown(d.insurance.pendingManual, r),
      byHour: d.insurance.byHour.map((h) => ({
        label: h.label,
        automatic: scaleDown(h.automatic, r),
        manual: scaleDown(h.manual, r),
      })),
    },
    quality: {
      ...d.quality,
      manualOrders: scaleDown(d.quality.manualOrders, r),
      badInputOrders: scaleDown(d.quality.badInputOrders, r),
      overnightOrders: scaleDown(d.quality.overnightOrders, r),
    },
    services: {
      byType: d.services.byType.map((s) => ({
        label: s.label,
        count: scaleDown(s.count, r),
      })),
      topWard: { ...d.services.topWard, count: scaleDown(d.services.topWard.count, r) },
    },
  };
}
