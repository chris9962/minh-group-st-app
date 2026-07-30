import type { BankAccount, BankAccountForm } from "@/lib/api/bankAccounts";
import type { Customer } from "@/lib/api/customers";
import { banksFor, consumeReferralCode } from "./bankCatalog";
import { ALL } from "./people";
import { accountsOf } from "./person";
import { giftRulesFor } from "./settings";

/**
 * P-20 · Tạo tài khoản ngân hàng — kho tài khoản THẬT do người dùng tạo qua
 * hộp thoại, khác với tài khoản giả lập sinh ra cho P-51/P-52. `customers.ts`
 * gộp cả hai để P-40/P-42 thấy tài khoản mới ngay sau khi lưu.
 *
 * Không import `./customers` — `customer` được TRUYỀN VÀO từ nơi gọi (handler
 * đã có sẵn, tra qua `findCustomer`), tránh vòng phụ thuộc hai chiều giữa hai
 * kho (customers.ts sẽ gộp `manualAccountsFor` từ đây).
 */

let manualAccounts: BankAccount[] = [];

export const manualAccountsFor = (customerName: string): BankAccount[] =>
  manualAccounts.filter((a) => a.customerName === customerName);

/** Toàn bộ tài khoản thật, không lọc theo khách — dùng cho P-21 (gộp cả công ty). */
export const allManualAccounts = (): BankAccount[] => manualAccounts;

let nextId = 1;

const THIS_MONTH = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
})();

/**
 * Tổng ngân hàng đã cài của khách, tính TRÊN TOÀN BỘ tài khoản kể cả tài
 * khoản do phòng khác tạo (spec §4.2, §4.8) — không phải con số đã cắt gọn
 * để hiển thị ở P-42.
 */
function trueInstalledBanks(customerName: string): Set<string> {
  const banks = new Set<string>();

  for (const p of ALL) {
    for (const a of accountsOf(p.fullName, THIS_MONTH, p.accounts)) {
      if (a.customerName === customerName && a.appInstalled) banks.add(a.bankName);
    }
  }
  for (const a of manualAccountsFor(customerName)) {
    if (a.appInstalled) banks.add(a.bankCode);
  }

  return banks;
}

/**
 * Ba luật cảnh báo mềm (spec §4.8), đọc chung bảng quy tắc quà (P-81) thay vì
 * một hằng số riêng — hai nơi tự chép một con số thì sửa một chỗ sẽ lệch chỗ
 * kia.
 */
function accountWarnings(customerName: string, newAccount: BankAccount): string[] {
  const banks = trueInstalledBanks(customerName);
  if (newAccount.appInstalled) banks.add(newAccount.bankCode);
  const appCount = banks.size;
  const warnings: string[] = [];

  const msbaRule = giftRulesFor().find(
    (r) => r.group === "cash" && r.requiredBank === "MSBa" && r.appCountComparator === "eq",
  );
  const msbaThreshold = msbaRule?.appCountValue ?? 3;
  if (banks.has("MSBa") && appCount < msbaThreshold) {
    warnings.push(
      `Cài MSBa bắt buộc đủ ${msbaThreshold} app, không đủ sẽ bị phạt (hiện có ${appCount}).`,
    );
  }

  const isVpaCnkd = newAccount.bankCode === "VPa" && newAccount.accountType !== "none";
  if (appCount === 1 && !isVpaCnkd) {
    warnings.push("Khách nên cài nhiều hơn 1 app.");
  }

  return warnings;
}

export function createBankAccount(
  form: BankAccountForm,
  customer: Customer,
  actor: { id: string; fullName: string; departmentId: string | null } | null,
): { account: BankAccount; warnings: string[] } | null {
  const bank = banksFor().find((b) => b.id === form.bankId);
  if (!bank) return null;

  const usedCode = consumeReferralCode(form.referralCode);
  if (!usedCode) return null;

  const account: BankAccount = {
    id: `mb-${nextId++}`,
    customerId: customer.id,
    customerName: customer.fullName,
    bankId: form.bankId,
    bankCode: bank.code,
    referralCode: usedCode.code,
    accountNumber: form.accountNumber,
    openedDate: form.openedDate,
    channel: form.channel,
    channelDetail: form.channelDetail,
    appInstalled: form.appInstalled,
    accountType: form.accountType,
    note: form.note,
    createdById: actor?.id ?? null,
    createdByName: actor?.fullName ?? null,
    createdByDepartmentId: actor?.departmentId ?? null,
  };
  manualAccounts = [...manualAccounts, account];

  return { account, warnings: accountWarnings(customer.fullName, account) };
}
