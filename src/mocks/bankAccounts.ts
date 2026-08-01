import type {
  BankAccount,
  BankAccountFinishForm,
  BankAccountStartForm,
} from "@/lib/api/bankAccounts";
import type { Customer } from "@/lib/api/customers";
import { banksFor, consumeReferralCode, findReferralCode } from "./bankCatalog";
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

/**
 * "Đang giữ" của một mã (mục 4.5) = đúng số tài khoản đang `creating` tham
 * chiếu mã đó — không có bảng lượt giữ riêng, tài khoản dở dang CHÍNH LÀ cái
 * giữ chỗ. `bankCatalog.ts` ghép số này vào lúc trả JSON cho `/referral-codes`.
 */
export const creatingCountForCode = (referralCodeId: string): number =>
  manualAccounts.filter((a) => a.status === "creating" && a.referralCodeId === referralCodeId)
    .length;

let nextId = 1;

const THIS_MONTH = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
})();

/**
 * Tổng ngân hàng đã cài của khách, tính TRÊN TOÀN BỘ tài khoản kể cả tài
 * khoản do phòng khác tạo (spec §4.2, §4.8) — không phải con số đã cắt gọn
 * để hiển thị ở P-42. Tài khoản còn `creating` chưa chắc đã cài app thật,
 * không tính.
 */
function trueInstalledBanks(customerName: string): Set<string> {
  const banks = new Set<string>();

  for (const p of ALL) {
    for (const a of accountsOf(p.fullName, THIS_MONTH, p.accounts)) {
      if (a.customerName === customerName && a.appInstalled) banks.add(a.bankName);
    }
  }
  for (const a of manualAccountsFor(customerName)) {
    if (a.status === "done" && a.appInstalled) banks.add(a.bankCode);
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

/**
 * Bước 1 (P-20) — chọn ngân hàng + mã, giữ chỗ ngay. Chặn nếu mã đã hết chỗ
 * THẬT, tính cả những tài khoản khác đang giữ mã này (`used + đang giữ`),
 * không chỉ `used` — hai người cùng bấm vào đúng lúc chỉ 1 chỗ thì người sau
 * phải bị chặn ở đây.
 */
export function startBankAccount(
  form: BankAccountStartForm,
  customer: Customer,
  actor: { id: string; fullName: string; departmentId: string | null } | null,
): BankAccount | null {
  const bank = banksFor().find((b) => b.id === form.bankId);
  if (!bank) return null;

  const code = findReferralCode(form.referralCode);
  if (!code) return null;
  if (code.used + creatingCountForCode(code.id) >= code.total) return null;

  const account: BankAccount = {
    id: `mb-${nextId++}`,
    customerId: customer.id,
    customerName: customer.fullName,
    bankId: form.bankId,
    bankCode: bank.code,
    referralCodeId: code.id,
    referralCode: code.code,
    accountNumber: "",
    openedDate: "",
    channel: customer.channel,
    channelDetail: customer.channelDetail,
    appInstalled: false,
    accountType: "none",
    note: "",
    createdById: actor?.id ?? null,
    createdByName: actor?.fullName ?? null,
    createdByDepartmentId: actor?.departmentId ?? null,
    photoUrls: [],
    status: "creating",
  };
  manualAccounts = [...manualAccounts, account];

  return account;
}

/**
 * Bước 2 (P-22, khi tài khoản đang `creating`) — điền nốt sau khi đã mở xong
 * ở ngoài. Chặn cứng nếu thiếu ảnh so với cấu hình ngân hàng (spec §4.7).
 * Mã giới thiệu chỉ THẬT SỰ bị tiêu ở đây, không phải lúc giữ chỗ.
 */
export function finishBankAccount(
  id: string,
  form: BankAccountFinishForm,
): { account: BankAccount; warnings: string[] } | null {
  const current = manualAccounts.find((a) => a.id === id);
  if (!current || current.status !== "creating") return null;

  const bank = banksFor().find((b) => b.id === current.bankId);
  if (!bank || current.photoUrls.length < bank.requiredPhotos) return null;

  const usedCode = consumeReferralCode(current.referralCodeId);
  if (!usedCode) return null;

  const updated: BankAccount = { ...current, ...form, status: "done" };
  manualAccounts = manualAccounts.map((a) => (a.id === id ? updated : a));

  return { account: updated, warnings: accountWarnings(current.customerName, updated) };
}

/**
 * Bỏ dở — chỉ xoá được khi còn `creating` (tài khoản đã `done` là lịch sử
 * thật, không được xoá). Xoá thẳng, không giữ lại bản ghi "đã huỷ": tài khoản
 * chưa từng thật sự mở thì không có gì để lưu vết.
 */
export function deleteBankAccount(id: string): boolean {
  const current = manualAccounts.find((a) => a.id === id);
  if (!current || current.status !== "creating") return false;
  manualAccounts = manualAccounts.filter((a) => a.id !== id);
  return true;
}

/** Thêm/thay/xoá ảnh chứng minh — dùng được ở cả hai trạng thái. */
export function setAccountPhotos(id: string, photoUrls: string[]): BankAccount | null {
  const current = manualAccounts.find((a) => a.id === id);
  if (!current) return null;

  const updated = { ...current, photoUrls };
  manualAccounts = manualAccounts.map((a) => (a.id === id ? updated : a));
  return updated;
}
