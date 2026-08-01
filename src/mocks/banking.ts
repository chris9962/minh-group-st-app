import type { BankAccountDetail, BankAccountQuery, BankAccountRow } from "@/lib/api/banking";
import { matchesSearch } from "@/lib/format";
import { seed } from "./activity";
import { allManualAccounts, manualAccountsFor } from "./bankAccounts";
import { banksFor } from "./bankCatalog";
import { findCustomer } from "./customers";
import { departments } from "./data";
import { ALL } from "./people";
import { accountsOf } from "./person";

/**
 * P-21 · Danh sách tài khoản ngân hàng — gộp tài khoản giả lập (12 nhân viên
 * P-51) với tài khoản THẬT tạo qua P-20 (`bankAccounts.ts`), giống cách
 * `customers.ts`/`services.ts` đã gộp cho P-40/P-31.
 */

const THIS_MONTH = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
})();

const departmentIdByName = (name: string): string | null =>
  departments.find((d) => d.name === name)?.id ?? null;

/**
 * STK giả cho tài khoản giả lập — `PersonAccount` (person.ts) không có
 * trường này vì P-42/P-52 chưa từng cần hiện số tài khoản. Không thêm vào đó
 * để tránh đụng hai màn đang chạy tốt; tự sinh riêng ở đây theo đúng khuôn số
 * điện thoại giả đã dùng khắp mock (`09` + 8 số).
 */
const fakeAccountNumber = (customerName: string, bankName: string, i: number): string =>
  `09${String(seed(customerName + bankName, i) * 1013 + 10_000_000).slice(0, 8)}`;

type TaggedRow = Omit<BankAccountRow, "createdByDepartmentName"> & { departmentId: string | null };

const departmentNameById = (id: string | null): string | null =>
  departments.find((d) => d.id === id)?.name ?? null;

function allRows(): TaggedRow[] {
  const rows: TaggedRow[] = [];

  for (const p of ALL) {
    const departmentId = departmentIdByName(p.departmentName);
    for (const a of accountsOf(p.fullName, THIS_MONTH, p.accounts)) {
      rows.push({
        id: `${p.id}-${a.id}`,
        // Tài khoản giả lập không có hồ sơ khách thật đứng sau — "" là đúng,
        // trang chi tiết đã có nhánh dự phòng khi không có id (như P-14).
        customerId: "",
        customerName: a.customerName,
        bankCode: a.bankName,
        accountNumber: fakeAccountNumber(a.customerName, a.bankName, rows.length),
        referralCode: a.referralCode,
        channel: a.channel,
        appInstalled: a.appInstalled,
        date: a.date,
        createdById: p.id,
        createdByName: p.fullName,
        departmentId,
        // Tài khoản giả lập luôn coi là đã hoàn thành — dữ liệu demo, không
        // có khái niệm đang tạo dở.
        status: "done",
      });
    }
  }

  for (const a of allManualAccounts()) {
    rows.push({
      id: a.id,
      customerId: a.customerId,
      customerName: a.customerName,
      bankCode: a.bankCode,
      accountNumber: a.accountNumber,
      referralCode: a.referralCode,
      channel: a.channel,
      appInstalled: a.appInstalled,
      date: a.openedDate,
      createdById: a.createdById,
      createdByName: a.createdByName,
      departmentId: a.createdByDepartmentId,
      status: a.status,
    });
  }

  return rows;
}

export function bankAccountsFor(
  query: BankAccountQuery,
  visibleDepartmentIds: string[] | null,
): { rows: BankAccountRow[]; summary: { total: number } } {
  const rows = allRows()
    .filter(
      (r) =>
        visibleDepartmentIds === null ||
        (r.departmentId !== null && visibleDepartmentIds.includes(r.departmentId)),
    )
    .filter((r) => !query.search || matchesSearch(r.customerName, query.search))
    .filter((r) => !query.bankCode || r.bankCode === query.bankCode)
    .filter((r) => !query.from || r.date >= query.from)
    .filter((r) => !query.to || r.date <= query.to)
    .filter((r) => !query.referralCode || r.referralCode === query.referralCode)
    .filter((r) => !query.channel || r.channel === query.channel)
    .filter((r) => !query.staffId || r.createdById === query.staffId)
    .filter((r) => !query.status || r.status === query.status)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(
      (r): BankAccountRow => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customerName,
        bankCode: r.bankCode,
        accountNumber: r.accountNumber,
        referralCode: r.referralCode,
        channel: r.channel,
        appInstalled: r.appInstalled,
        date: r.date,
        createdById: r.createdById,
        createdByName: r.createdByName,
        createdByDepartmentName: departmentNameById(r.departmentId),
        status: r.status,
      }),
    );

  return { rows, summary: { total: rows.length } };
}

/**
 * P-22 · Chi tiết — kiểm phạm vi Ở ĐÂY, không chỉ ở danh sách P-21. Đổi id
 * trên URL sang một bản ghi ngoài phạm vi phải trả về null (spec §1.1.6).
 */
export function bankAccountDetailFor(
  id: string,
  visibleDepartmentIds: string[] | null,
): BankAccountDetail | null {
  const row = allRows().find((r) => r.id === id);
  if (!row) return null;
  if (visibleDepartmentIds !== null && (row.departmentId === null || !visibleDepartmentIds.includes(row.departmentId))) {
    return null;
  }

  const manual = manualAccountsFor(row.customerName).find((a) => a.id === id);
  const { departmentId, ...base } = row;
  const bank = banksFor().find((b) => b.code === row.bankCode);
  const customer = findCustomer(row.customerId);
  const primaryPhone = customer?.phones.find((p) => p.primary)?.number ?? customer?.phones[0]?.number ?? "";

  return {
    ...base,
    createdByDepartmentName: departmentNameById(departmentId),
    channelDetail: manual?.channelDetail ?? "",
    accountType: manual?.accountType ?? "none",
    note: manual?.note ?? "",
    createdByDepartmentId: departmentId,
    photoUrls: manual?.photoUrls ?? [],
    requiredPhotos: bank?.requiredPhotos ?? 0,
    accountNumberMethod: bank?.accountNumberMethod ?? "manual",
    customerPrimaryPhone: primaryPhone,
  };
}
