import type { Bank, BankForm, ReferralCode, ReferralCodeForm } from "@/lib/api/bankCatalog";

/**
 * Kho ngân hàng (P-60) + kho mã giới thiệu (P-61). Danh sách 11 ngân hàng +
 * CNKD + HKD khớp mgst-platform-spec.md §2.6 — không phải danh mục tự đặt.
 */

let banks: Bank[] = [
  { id: "bk-mb", code: "MB", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: true },
  { id: "bk-vpa", code: "VPa", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: true },
  { id: "bk-vpb", code: "VPb", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1.4, countsAsApp: true },
  { id: "bk-lbp", code: "LBP", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: true },
  { id: "bk-msba", code: "MSBa", active: true, requiredPhotos: 3, accountNumberMethod: "manual", coefficient: 1, countsAsApp: true },
  { id: "bk-msbb", code: "MSBb", active: true, requiredPhotos: 3, accountNumberMethod: "manual", coefficient: 1, countsAsApp: true },
  { id: "bk-tcb", code: "TCB", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: true },
  { id: "bk-bidv", code: "BIDV", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: true },
  { id: "bk-tpb", code: "TPB", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: true },
  { id: "bk-vib", code: "VIB", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: true },
  { id: "bk-shb", code: "SHB", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: true },
  { id: "bk-cnkd", code: "CNKD", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: false },
  { id: "bk-hkd", code: "HKD", active: true, requiredPhotos: 3, accountNumberMethod: "phone-match", coefficient: 1, countsAsApp: false },
];

let nextBankId = 1;

export const banksFor = (): Bank[] => banks;

export function createBank(form: BankForm): Bank {
  const bank: Bank = { id: `bk-new-${nextBankId++}`, active: true, ...form };
  banks = [...banks, bank];
  return bank;
}

export function updateBank(id: string, form: BankForm): Bank | null {
  const current = banks.find((b) => b.id === id);
  if (!current) return null;
  const next = { ...current, ...form };
  banks = banks.map((b) => (b.id === id ? next : b));
  return next;
}

export function setBankActive(id: string, active: boolean): Bank | null {
  const current = banks.find((b) => b.id === id);
  if (!current) return null;
  const next = { ...current, active };
  banks = banks.map((b) => (b.id === id ? next : b));
  return next;
}

/* ── P-61 · Kho mã giới thiệu ─────────────────────────────────────────── */

/**
 * Không lưu `holding` ở đây — "đang giữ" của một mã = số tài khoản đang
 * `creating` tham chiếu mã đó (mục 4.5), tính từ `bankAccounts.ts`. Lưu tĩnh
 * ở đây thì sẽ có hai nguồn sự thật lệch nhau. `holding` chỉ được GHÉP vào
 * lúc trả JSON, ở `handlers.ts` (nơi đã import được cả hai kho).
 */
type StoredReferralCode = Omit<ReferralCode, "holding">;

let codes: StoredReferralCode[] = [
  { id: "rc-1", bankId: "bk-vpa", code: "VPA-2024-01", used: 47, total: 100 },
  { id: "rc-2", bankId: "bk-vpa", code: "VPA-2024-02", used: 12, total: 100 },
  { id: "rc-3", bankId: "bk-msba", code: "MSBA-01", used: 85, total: 100 },
  { id: "rc-4", bankId: "bk-tpb", code: "TPB-01", used: 100, total: 100 },
  { id: "rc-5", bankId: "bk-mb", code: "MB-01", used: 10, total: 50 },
  { id: "rc-6", bankId: "bk-vpb", code: "VPB-2024-01", used: 30, total: 100 },
];

let nextCodeId = 1;

/**
 * Không lọc theo trạng thái (còn chỗ/sắp hết/đầy) ở đây nữa — trạng thái cần
 * `holding` thật, chỉ có sau khi ghép ở `handlers.ts`.
 */
export function referralCodesFor(query: { bankId: string }): StoredReferralCode[] {
  return codes.filter((c) => !query.bankId || c.bankId === query.bankId);
}

export function createReferralCode(form: ReferralCodeForm): StoredReferralCode {
  const code: StoredReferralCode = {
    id: `rc-new-${nextCodeId++}`,
    bankId: form.bankId,
    code: form.code,
    total: form.total,
    used: 0,
  };
  codes = [...codes, code];
  return code;
}

export const findReferralCode = (id: string): StoredReferralCode | null =>
  codes.find((c) => c.id === id) ?? null;

/**
 * Tiêu một lượt thật — gọi ở BƯỚC 2 lúc tài khoản chuyển sang `done`
 * (`bankAccounts.ts#finishBankAccount`), không phải lúc chọn mã ở bước 1.
 * Không cho dùng mã đã đầy (tính cả đang giữ, xem `codeStatusOf`).
 */
export function consumeReferralCode(id: string): StoredReferralCode | null {
  const current = codes.find((c) => c.id === id);
  if (!current || current.used >= current.total) return null;
  const next = { ...current, used: current.used + 1 };
  codes = codes.map((c) => (c.id === id ? next : c));
  return next;
}
