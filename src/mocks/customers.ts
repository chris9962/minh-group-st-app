import {
  CUSTOMER_ERROR,
  type Customer,
  type CustomerDetail,
  type CustomerForm,
  type CustomerList,
  type CustomerPhone,
  type CustomerRow,
} from "@/lib/api/customers";
import { digitsOnly, matchesSearch } from "@/lib/format";
import { scopeFor, visibleDepartmentIds } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { CUSTOMERS, seed } from "./activity";
import { departments } from "./data";
import { ALL } from "./people";
import { accountsOf, insuranceOf } from "./person";
import { simulateGift } from "./settings";

/**
 * Kho khách hàng cho P-40 · P-41 · P-42.
 *
 * KHÔNG tự sinh tài khoản/đơn bảo hiểm riêng — dựng lại từ đúng `accountsOf` /
 * `insuranceOf` mà P-52 đang dùng, gộp qua mọi nhân viên. Tự sinh riêng thì
 * "3 tài khoản" ở đây và tổng cộng dồn từ P-52 sẽ lệch nhau.
 */

const STREETS = ["Nguyễn Trãi", "Lê Lợi", "Trần Hưng Đạo", "Hùng Vương", "Điện Biên Phủ"];
const WARDS_ADDR = ["Phường Tân Bình", "Phường Tân Hoà", "Xã Tân Lập", "Xã Tân Phú"];

const phoneFor = (name: string, salt: number): string =>
  `09${String(seed(name, salt) * 1013 + 10_000_000).slice(0, 8)}`;

/** Mã hoá vị trí vào chữ số nghìn để chắc chắn không trùng giữa 20 khách. */
const idNumberFor = (name: string, index: number): string =>
  `092${String(300_000_000 + index * 1000 + (seed(name, 5) % 1000)).padStart(9, "0")}`;

let customers: Customer[] = CUSTOMERS.map((fullName, i) => {
  // Vài khách chưa có CCCD — module B chưa chắc bắt buộc (spec §2.1, câu hỏi mở).
  const hasIdNumber = i % 7 !== 6;
  const phones: CustomerPhone[] = [
    { id: `ph-${i}-1`, number: phoneFor(fullName, 7), primary: true },
  ];
  if (i % 4 === 0) {
    phones.push({ id: `ph-${i}-2`, number: phoneFor(fullName, 17), primary: false });
  }

  return {
    id: `c${i + 1}`,
    fullName,
    dob: hasIdNumber
      ? `${1965 + (seed(fullName, 2) % 40)}-${String(1 + (seed(fullName, 4) % 12)).padStart(2, "0")}-${String(1 + (seed(fullName, 6) % 28)).padStart(2, "0")}`
      : null,
    idNumber: hasIdNumber ? idNumberFor(fullName, i) : null,
    address: `${10 + (seed(fullName, 8) % 200)} ${STREETS[seed(fullName, 9) % STREETS.length]}, ${WARDS_ADDR[seed(fullName, 10) % WARDS_ADDR.length]}`,
    phones,
  };
});

let nextCustomerId = customers.length + 1;

const THIS_MONTH = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
})();

const departmentIdByName = (name: string): string | null =>
  departments.find((d) => d.name === name)?.id ?? null;

type TaggedAccount = ReturnType<typeof accountsOf>[number] & { departmentId: string | null };
type TaggedInsurance = ReturnType<typeof insuranceOf>[number] & { departmentId: string | null };

/**
 * Dựng lại toàn bộ tài khoản/đơn bảo hiểm của mọi nhân viên, kèm phòng đã tạo
 * ra nó — cần để lọc theo phạm vi ở P-42. Số lượng nhỏ (12 người) nên tính lại
 * mỗi lần gọi, không cần cache.
 */
function allAccountsAndInsurance(): { accounts: TaggedAccount[]; insurance: TaggedInsurance[] } {
  const accounts: TaggedAccount[] = [];
  const insurance: TaggedInsurance[] = [];

  for (const p of ALL) {
    const departmentId = departmentIdByName(p.departmentName);
    // `id` của accountsOf/insuranceOf chỉ duy nhất TRONG một nhân viên (a1, a2…
    // lặp lại ở người khác) — thêm tiền tố theo người tạo để không đụng nhau
    // khi gộp qua cả công ty, nếu không bảng ở P-42 sẽ trùng khoá React.
    for (const a of accountsOf(p.fullName, THIS_MONTH, p.accounts)) {
      accounts.push({ ...a, id: `${p.id}-${a.id}`, departmentId });
    }
    for (const ins of insuranceOf(p.fullName, THIS_MONTH, p.insuranceOrders)) {
      insurance.push({ ...ins, id: `${p.id}-${ins.id}`, departmentId });
    }
  }

  return { accounts, insurance };
}

const newestFirst = <T extends { date: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));

/**
 * Gộp qua 12 nhân viên thì mỗi khách cộng dồn tới vài chục dòng — không thật.
 * Khách đời thường có khoảng 2-3 tài khoản ngân hàng và 1-2 đơn bảo hiểm, nên
 * cắt về mức đó (giữ dòng mới nhất) ngay tại đây — không cần sửa `accountsOf`
 * dùng chung với P-52, P-52 vẫn đúng vì nó không cộng dồn qua nhiều người.
 */
const accountsFor = (fullName: string, all: TaggedAccount[]): TaggedAccount[] => {
  const mine = all.filter((a) => a.customerName === fullName);
  const cap = 2 + (seed(fullName, 41) % 2); // 2 hoặc 3
  return newestFirst(mine).slice(0, cap);
};

const insuranceFor = (fullName: string, all: TaggedInsurance[]): TaggedInsurance[] => {
  const mine = all.filter((i) => i.customerName === fullName);
  const cap = 1 + (seed(fullName, 43) % 2); // 1 hoặc 2
  return newestFirst(mine).slice(0, cap);
};

function primaryPhoneOf(c: Customer): string {
  return c.phones.find((p) => p.primary)?.number ?? c.phones[0]?.number ?? "";
}

/**
 * Tìm không dấu, không phân biệt thứ tự từ (tên) + 4 số cuối CCCD + SĐT bất kỳ,
 * có hoặc không mã vùng/khoảng trắng (spec §2.1 "Bộ tìm kiếm thông minh").
 */
function matchesCustomer(c: Customer, query: string): boolean {
  if (matchesSearch(c.fullName, query)) return true;

  const digits = digitsOnly(query);
  if (digits.length < 3) return false;

  if (c.idNumber && digitsOnly(c.idNumber).includes(digits)) return true;

  const normalized = digits.startsWith("84") ? `0${digits.slice(2)}` : digits;
  return c.phones.some(
    (p) => digitsOnly(p.number).includes(digits) || digitsOnly(p.number).includes(normalized),
  );
}

function giftResultFor(fullName: string, accounts: TaggedAccount[]) {
  const mine = accountsFor(fullName, accounts);
  const installedBanks = [...new Set(mine.filter((a) => a.appInstalled).map((a) => a.bankName))];
  const cnkd = mine.some((a) => a.accountType === "CNKD" || a.accountType === "HKD");
  const channels = [...new Set(mine.map((a) => a.channel))];
  return simulateGift({ installedBanks, cnkd, channels });
}

function giftEligible(fullName: string, accounts: TaggedAccount[]): boolean {
  const result = giftResultFor(fullName, accounts);
  return result.cashTotal > 0 || result.basket.length > 0;
}

/**
 * Vài khách đã được tặng quà — để màn hình có đủ ba trạng thái (chưa đủ ĐK,
 * đủ ĐK chưa phát, đã tặng). Luồng Tặng quà thật (P-43) chưa làm, đây chỉ là
 * seed tĩnh chứ không phải kết quả của một thao tác tặng quà thật.
 */
const giftGiven: Map<string, string> = (() => {
  const map = new Map<string, string>();
  const { accounts } = allAccountsAndInsurance();
  const givenAt = [2, 7, 13];
  for (const i of givenAt) {
    const c = customers[i];
    if (!c) continue;
    const result = giftResultFor(c.fullName, accounts);
    const item = result.basket[0]?.name ?? (result.cashTotal > 0 ? "Tiền mặt" : null);
    if (item) map.set(c.id, item);
  }
  return map;
})();

export function customersFor(search: string): CustomerList {
  const { accounts, insurance } = allAccountsAndInsurance();

  const rows: CustomerRow[] = customers
    .filter((c) => !search.trim() || matchesCustomer(c, search))
    .map((c) => ({
      id: c.id,
      fullName: c.fullName,
      primaryPhone: primaryPhoneOf(c),
      accountCount: accountsFor(c.fullName, accounts).length,
      insuranceCount: insuranceFor(c.fullName, insurance).length,
      giftStatus: giftGiven.has(c.id) ? "given" : giftEligible(c.fullName, accounts) ? "eligible" : "none",
      givenItem: giftGiven.get(c.id) ?? null,
    }));

  return { summary: { total: customers.length }, customers: rows };
}

export const findCustomer = (id: string): Customer | null =>
  customers.find((c) => c.id === id) ?? null;

export type CustomerOutcome =
  | { ok: true; customer: Customer }
  | {
      ok: false;
      code: typeof CUSTOMER_ERROR.DUPLICATE_ID;
      existing: Customer;
    };

function toStoredPhones(id: string, form: CustomerForm): CustomerPhone[] {
  // Đúng một số chính — nếu form lỡ gửi 0 hoặc nhiều hơn 1, lấy số đầu làm chính.
  const hasPrimary = form.phones.some((p) => p.primary);
  return form.phones.map((p, i) => ({
    id: `ph-${id}-${i}`,
    number: p.number,
    primary: hasPrimary ? p.primary : i === 0,
  }));
}

export function createCustomer(form: CustomerForm): CustomerOutcome {
  if (form.idNumber) {
    const dup = customers.find((c) => c.idNumber === form.idNumber);
    if (dup) return { ok: false, code: CUSTOMER_ERROR.DUPLICATE_ID, existing: dup };
  }

  const id = `c-new-${nextCustomerId++}`;
  const customer: Customer = {
    id,
    fullName: form.fullName,
    dob: form.dob || null,
    idNumber: form.idNumber || null,
    address: form.address,
    phones: toStoredPhones(id, form),
  };
  customers = [...customers, customer];
  return { ok: true, customer };
}

export function updateCustomer(id: string, form: CustomerForm): CustomerOutcome | null {
  const current = customers.find((c) => c.id === id);
  if (!current) return null;

  if (form.idNumber) {
    const dup = customers.find((c) => c.idNumber === form.idNumber && c.id !== id);
    if (dup) return { ok: false, code: CUSTOMER_ERROR.DUPLICATE_ID, existing: dup };
  }

  const next: Customer = {
    ...current,
    fullName: form.fullName,
    dob: form.dob || null,
    idNumber: form.idNumber || null,
    address: form.address,
    phones: toStoredPhones(id, form),
  };
  customers = customers.map((c) => (c.id === id ? next : c));
  return { ok: true, customer: next };
}

/** Tóm tắt hồ sơ đã có — cho hộp thoại "Dùng hồ sơ này" khi gõ trùng CCCD. */
export function customerSummary(c: Customer): {
  id: string;
  fullName: string;
  primaryPhone: string;
  accountCount: number;
  insuranceCount: number;
} {
  const { accounts, insurance } = allAccountsAndInsurance();
  return {
    id: c.id,
    fullName: c.fullName,
    primaryPhone: primaryPhoneOf(c),
    accountCount: accountsFor(c.fullName, accounts).length,
    insuranceCount: insuranceFor(c.fullName, insurance).length,
  };
}

/**
 * Hồ sơ 360° — hiển thị theo phạm vi, nhưng quà tính trên TOÀN BỘ tài khoản
 * (spec §4.4 P-42, hai lỗi thường gặp). `actor` là NGƯỜI ĐANG XEM, máy chủ tự
 * tính phạm vi từ đó chứ không tin phạm vi client gửi lên.
 */
export function customerDetailFor(id: string, actor: User | null): CustomerDetail | null {
  const customer = findCustomer(id);
  if (!customer) return null;

  const { accounts: allAccounts, insurance: allInsurance } = allAccountsAndInsurance();
  const myAccounts = accountsFor(customer.fullName, allAccounts);
  const myInsurance = insuranceFor(customer.fullName, allInsurance);

  const bankingScope = scopeFor(actor, "banking", "view-detail");
  const bankingVisible = bankingScope ? visibleDepartmentIds(actor, bankingScope) : [];
  const insuranceScope = scopeFor(actor, "insurance", "view-detail");
  const insuranceVisible = insuranceScope ? visibleDepartmentIds(actor, insuranceScope) : [];

  const isVisible = (departmentId: string | null, allowed: string[] | null) =>
    allowed === null || (departmentId !== null && allowed.includes(departmentId));

  const visibleAccounts = myAccounts.filter((a) => isVisible(a.departmentId, bankingVisible));
  const visibleInsurance = myInsurance.filter((i) => isVisible(i.departmentId, insuranceVisible));

  const installedBanks = [
    ...new Set(myAccounts.filter((a) => a.appInstalled).map((a) => a.bankName)),
  ];
  const cnkd = myAccounts.some((a) => a.accountType === "CNKD" || a.accountType === "HKD");
  const channels = [...new Set(myAccounts.map((a) => a.channel))];
  const gift = simulateGift({ installedBanks, cnkd, channels });

  return {
    customer,
    accounts: visibleAccounts.map((a) => ({
      id: a.id,
      date: a.date,
      bankName: a.bankName,
      referralCode: a.referralCode,
      appInstalled: a.appInstalled,
    })),
    accountsHiddenCount: myAccounts.length - visibleAccounts.length,
    insurance: visibleInsurance.map((i) => ({
      id: i.id,
      date: i.date,
      product: i.product,
      packageName: i.packageName,
      status: i.status,
      // Luôn 'self' — luồng Tặng quà (P-43) tự tạo đơn 'gift' chưa làm.
      source: "self" as const,
    })),
    insuranceHiddenCount: myInsurance.length - visibleInsurance.length,
    gift: { ...gift, given: giftGiven.has(id), givenItem: giftGiven.get(id) ?? null },
  };
}
