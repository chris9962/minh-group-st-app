import {
  type CatalogItemForm,
  type GiftItem,
  type GiftRule,
  type GiftRuleForm,
  type GiftSimulateInput,
  type GiftSimulateResult,
  type InsurancePackage,
  type InsurancePackageForm,
  type KpiTarget,
  type KpiTargetForm,
  type ServiceTypeForm,
  type ServiceTypeRow,
} from "@/lib/api/settings";
import { banksFor } from "./bankCatalog";

/**
 * Kho cấu hình cho P-81…P-84. Giữ trong bộ nhớ và sửa được — admin lập/sửa
 * quy tắc, danh mục, chỉ tiêu phải thấy kết quả ngay để kiểm luồng.
 */

/* ── P-82 · Danh mục quà & gói bảo hiểm ──────────────────────────────── */

let giftItems: GiftItem[] = [
  { id: "gi-loa", name: "Loa", active: true },
  { id: "gi-mica", name: "Bảng mica", active: true },
  { id: "gi-mi", name: "Mì", active: true },
  { id: "gi-non", name: "Nón bảo hiểm", active: true },
  { id: "gi-bhsk", name: "BH sức khoẻ", active: true },
];

let insurancePackages: InsurancePackage[] = [
  { id: "ip-xemay-1n", name: "1 năm BH xe máy", yearlyFee: 100000, active: true },
  { id: "ip-dien-1n", name: "1 năm BH tai nạn điện", yearlyFee: 100000, active: true },
  {
    id: "ip-combo-1n",
    name: "1 năm xe máy + 1 năm tai nạn điện",
    yearlyFee: 200000,
    active: true,
  },
  { id: "ip-xemay-2n", name: "2 năm BH xe máy", yearlyFee: 200000, active: true },
  {
    id: "ip-dien-2n-100k",
    name: "2 năm tai nạn điện gói 100k",
    yearlyFee: 200000,
    active: true,
  },
  {
    id: "ip-dien-1n-200k",
    name: "1 năm tai nạn điện gói 200k",
    yearlyFee: 200000,
    active: true,
  },
];

let nextCatalogId = 1;

export const giftItemsFor = (): GiftItem[] => giftItems;

export function createGiftItemRow(form: CatalogItemForm): GiftItem {
  const item: GiftItem = { id: `gi-new-${nextCatalogId++}`, name: form.name, active: true };
  giftItems = [...giftItems, item];
  return item;
}

export function setGiftItemActiveRow(id: string, active: boolean): GiftItem | null {
  const current = giftItems.find((g) => g.id === id);
  if (!current) return null;
  const next = { ...current, active };
  giftItems = giftItems.map((g) => (g.id === id ? next : g));
  return next;
}

export const insurancePackagesFor = (): InsurancePackage[] => insurancePackages;

export function createInsurancePackageRow(form: InsurancePackageForm): InsurancePackage {
  const pkg: InsurancePackage = {
    id: `ip-new-${nextCatalogId++}`,
    name: form.name,
    yearlyFee: form.yearlyFee,
    active: true,
  };
  insurancePackages = [...insurancePackages, pkg];
  return pkg;
}

export function updateInsurancePackageRow(
  id: string,
  form: InsurancePackageForm,
): InsurancePackage | null {
  const current = insurancePackages.find((p) => p.id === id);
  if (!current) return null;
  const next = { ...current, name: form.name, yearlyFee: form.yearlyFee };
  insurancePackages = insurancePackages.map((p) => (p.id === id ? next : p));
  return next;
}

export function setInsurancePackageActiveRow(
  id: string,
  active: boolean,
): InsurancePackage | null {
  const current = insurancePackages.find((p) => p.id === id);
  if (!current) return null;
  const next = { ...current, active };
  insurancePackages = insurancePackages.map((p) => (p.id === id ? next : p));
  return next;
}

/** Tra tên món theo id, dùng cho cả hai catalog — nút thử cần tên hiển thị. */
function giftNameOf(id: string): string {
  return (
    giftItems.find((g) => g.id === id)?.name ??
    insurancePackages.find((p) => p.id === id)?.name ??
    id
  );
}

/* ── P-81 · Quy tắc quà ───────────────────────────────────────────────── */

let giftRules: GiftRule[] = [
  {
    id: "gr-1",
    order: 1,
    group: "cash",
    mode: "accumulate",
    requiredBank: "VPa",
    requiresCnkd: false,
    appCountComparator: "none",
    appCountValue: null,
    channel: null,
    cashAmount: 20000,
    giftItemIds: [],
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    active: true,
  },
  {
    id: "gr-2",
    order: 2,
    group: "cash",
    mode: "accumulate",
    requiredBank: "MSBa",
    requiresCnkd: false,
    appCountComparator: "eq",
    appCountValue: 3,
    channel: null,
    cashAmount: 50000,
    giftItemIds: [],
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    active: true,
  },
  {
    id: "gr-3",
    order: 3,
    group: "choice",
    mode: "tiered",
    requiredBank: "MSBa",
    requiresCnkd: false,
    appCountComparator: "gte",
    appCountValue: 3,
    channel: null,
    cashAmount: null,
    giftItemIds: ["ip-xemay-1n", "ip-dien-1n"],
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    active: true,
  },
  {
    id: "gr-4",
    order: 4,
    group: "choice",
    mode: "tiered",
    requiredBank: null,
    requiresCnkd: false,
    appCountComparator: "gte",
    appCountValue: 3,
    channel: null,
    cashAmount: null,
    giftItemIds: ["ip-combo-1n", "ip-xemay-2n", "ip-dien-2n-100k", "ip-dien-1n-200k"],
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    active: true,
  },
  {
    id: "gr-5",
    order: 5,
    group: "choice",
    mode: "tiered",
    requiredBank: null,
    requiresCnkd: false,
    appCountComparator: "gte",
    appCountValue: 2,
    channel: null,
    cashAmount: null,
    giftItemIds: ["ip-xemay-1n", "ip-dien-1n"],
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    active: true,
  },
  {
    id: "gr-6",
    order: 6,
    group: "choice",
    mode: "addon",
    requiredBank: "VPa",
    requiresCnkd: true,
    appCountComparator: "none",
    appCountValue: null,
    channel: null,
    cashAmount: null,
    giftItemIds: ["gi-loa", "gi-mica"],
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    active: true,
  },
  {
    id: "gr-7",
    order: 7,
    group: "choice",
    mode: "addon",
    requiredBank: null,
    requiresCnkd: false,
    appCountComparator: "none",
    appCountValue: null,
    channel: "Bệnh viện",
    cashAmount: null,
    giftItemIds: ["gi-mi", "gi-bhsk", "gi-non"],
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    active: true,
  },
];

let nextRuleId = 8;

const byOrder = (rows: GiftRule[]): GiftRule[] => [...rows].sort((a, b) => a.order - b.order);

export const giftRulesFor = (): GiftRule[] => byOrder(giftRules);

const emptyToNull = (s: string): string | null => (s.trim() ? s.trim() : null);

function toGiftRule(id: string, order: number, active: boolean, form: GiftRuleForm): GiftRule {
  return {
    id,
    order,
    group: form.group,
    mode: form.mode,
    requiredBank: emptyToNull(form.requiredBank),
    requiresCnkd: form.requiresCnkd,
    appCountComparator: form.appCountComparator,
    appCountValue: form.appCountComparator === "none" ? null : form.appCountValue,
    channel: emptyToNull(form.channel),
    cashAmount: form.group === "cash" ? form.cashAmount : null,
    giftItemIds: form.group === "choice" ? form.giftItemIds : [],
    effectiveFrom: form.effectiveFrom,
    effectiveTo: emptyToNull(form.effectiveTo),
    active,
  };
}

export function createGiftRule(form: GiftRuleForm): GiftRule {
  const order = giftRules.length ? Math.max(...giftRules.map((r) => r.order)) + 1 : 1;
  const rule = toGiftRule(`gr-new-${nextRuleId++}`, order, true, form);
  giftRules = [...giftRules, rule];
  return rule;
}

export function updateGiftRule(id: string, form: GiftRuleForm): GiftRule | null {
  const current = giftRules.find((r) => r.id === id);
  if (!current) return null;
  const next = toGiftRule(id, current.order, current.active, form);
  giftRules = giftRules.map((r) => (r.id === id ? next : r));
  return next;
}

export function setGiftRuleActiveRow(id: string, active: boolean): GiftRule | null {
  const current = giftRules.find((r) => r.id === id);
  if (!current) return null;
  const next = { ...current, active };
  giftRules = giftRules.map((r) => (r.id === id ? next : r));
  return next;
}

/**
 * Đổi thứ tự ưu tiên bằng cách hoán đổi `order` với dòng liền kề — dùng nút
 * lên/xuống thay vì kéo-thả, để còn thao tác được bằng bàn phím (AGENTS.md §8).
 */
export function moveGiftRule(id: string, direction: "up" | "down"): GiftRule[] | null {
  const sorted = byOrder(giftRules);
  const index = sorted.findIndex((r) => r.id === id);
  if (index === -1) return null;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= sorted.length) return byOrder(giftRules);

  const a = sorted[index];
  const b = sorted[swapWith];
  const aOrder = a.order;
  giftRules = giftRules.map((r) => {
    if (r.id === a.id) return { ...r, order: b.order };
    if (r.id === b.id) return { ...r, order: aOrder };
    return r;
  });
  return byOrder(giftRules);
}

/* ── Nút thử — spec §5.1–5.3, không ghi gì ───────────────────────────── */

const inEffect = (rule: GiftRule, today: string): boolean =>
  rule.active && rule.effectiveFrom <= today && (!rule.effectiveTo || today <= rule.effectiveTo);

function matches(rule: GiftRule, input: GiftSimulateInput, appCount: number): boolean {
  if (rule.requiredBank && !input.installedBanks.includes(rule.requiredBank)) return false;
  if (rule.requiresCnkd && !input.cnkd) return false;
  if (rule.channel && !input.channels.includes(rule.channel)) return false;
  if (rule.appCountComparator === "eq") return appCount === rule.appCountValue;
  if (rule.appCountComparator === "gte") return appCount >= (rule.appCountValue ?? 0);
  return true;
}

/** Mỗi ngân hàng đã cài +1 điểm, mở CNKD/HKD +1 điểm (spec §5.1 — chưa có bảng hệ số riêng theo ngân hàng, P-60). */
export function simulateGift(input: GiftSimulateInput): GiftSimulateResult {
  const today = new Date().toISOString().slice(0, 10);
  const active = giftRulesFor().filter((r) => inEffect(r, today));
  const appCount = input.installedBanks.length;

  const cashRules = active.filter((r) => r.group === "cash" && matches(r, input, appCount));
  const cashBreakdown = cashRules.map((r) => ({
    label: `${r.requiredBank ?? "—"}${
      r.appCountComparator !== "none" ? ` · tổng app ${r.appCountComparator === "eq" ? "=" : "≥"} ${r.appCountValue}` : ""
    }`,
    amount: r.cashAmount ?? 0,
  }));
  const cashTotal = cashBreakdown.reduce((sum, b) => sum + b.amount, 0);

  const basket: GiftSimulateResult["basket"] = [];

  const tiered = active
    .filter((r) => r.group === "choice" && r.mode === "tiered")
    .find((r) => matches(r, input, appCount));
  if (tiered) {
    for (const id of tiered.giftItemIds) {
      basket.push({ id, name: giftNameOf(id), source: `mức bậc thang (thứ tự ${tiered.order})` });
    }
  }

  const addons = active.filter(
    (r) => r.group === "choice" && r.mode === "addon" && matches(r, input, appCount),
  );
  for (const rule of addons) {
    const source = rule.channel
      ? `kênh ${rule.channel}`
      : rule.requiresCnkd
        ? "mở CNKD/HKD"
        : `thứ tự ${rule.order}`;
    for (const id of rule.giftItemIds) {
      basket.push({ id, name: giftNameOf(id), source });
    }
  }

  // Hệ số đọc từ chính kho ngân hàng (P-60) — sửa hệ số ở đó thì nút thử tính
  // theo ngay, không phải hằng số lặp lại ở đây.
  const kpiBreakdown = input.installedBanks.map((code) => ({
    label: code,
    points: banksFor().find((b) => b.code === code)?.coefficient ?? 1,
  }));
  if (input.cnkd) kpiBreakdown.push({ label: "Mở CNKD/HKD", points: 1 });
  const kpiPoints = kpiBreakdown.reduce((sum, b) => sum + b.points, 0);

  return { cashTotal, cashBreakdown, basket, kpiPoints, kpiBreakdown };
}

/* ── P-83 · Chỉ tiêu KPI theo tháng ──────────────────────────────────── */

/**
 * MỘT chỉ tiêu chung cho toàn công ty — chưa tách riêng theo phòng/người
 * (câu hỏi mở ở mgst-feature-list.md §4.8 P-83). `src/mocks/people.ts` và
 * `person.ts` đọc số này thay vì hằng số cứng, nên sửa ở đây có hiệu lực
 * ngay trên P-51/P-52.
 */
let kpiTarget: KpiTarget = { monthlyPoints: 100, warnDaysLeft: 7 };

export const kpiTargetFor = (): KpiTarget => kpiTarget;

export function updateKpiTargetRow(form: KpiTargetForm): KpiTarget {
  kpiTarget = { monthlyPoints: form.monthlyPoints, warnDaysLeft: form.warnDaysLeft };
  return kpiTarget;
}

/* ── P-84 · Danh mục loại dịch vụ + hệ số điểm ───────────────────────── */

/**
 * Danh mục đúng theo mgst-platform-spec.md §6 — "danh mục admin setup".
 * Tên khớp với `SERVICE_TYPES` ở `./person.ts` (P-52 tab Dịch vụ) để hai màn
 * không lệch chữ của cùng một loại dịch vụ.
 */
let serviceTypes: ServiceTypeRow[] = [
  { id: "st-1", name: "Thanh toán hoá đơn", active: true, coefficient: 1 },
  { id: "st-2", name: "Nạp / rút", active: true, coefficient: 1 },
  { id: "st-3", name: "Thủ tục hành chính", active: true, coefficient: 1 },
  { id: "st-4", name: "Bảo hiểm xã hội", active: true, coefficient: 1 },
  { id: "st-5", name: "Bảo hiểm y tế", active: true, coefficient: 1 },
];

let nextServiceTypeId = 1;

export const serviceTypesFor = (): ServiceTypeRow[] => serviceTypes;

export function createServiceTypeRow(form: ServiceTypeForm): ServiceTypeRow {
  const row: ServiceTypeRow = {
    id: `st-new-${nextServiceTypeId++}`,
    name: form.name,
    coefficient: form.coefficient,
    active: true,
  };
  serviceTypes = [...serviceTypes, row];
  return row;
}

export function updateServiceTypeRow(id: string, form: ServiceTypeForm): ServiceTypeRow | null {
  const current = serviceTypes.find((s) => s.id === id);
  if (!current) return null;
  const next = { ...current, name: form.name, coefficient: form.coefficient };
  serviceTypes = serviceTypes.map((s) => (s.id === id ? next : s));
  return next;
}

export function setServiceTypeActiveRow(id: string, active: boolean): ServiceTypeRow | null {
  const current = serviceTypes.find((s) => s.id === id);
  if (!current) return null;
  const next = { ...current, active };
  serviceTypes = serviceTypes.map((s) => (s.id === id ? next : s));
  return next;
}
