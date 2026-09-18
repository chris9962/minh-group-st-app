import { fetchBankAccounts } from '@/lib/api/banking';
import { fetchCustomerLookup, type CustomerLookupRow } from '@/lib/api/customers';
import { fetchInsuranceOrders } from '@/lib/api/insurance';
import { fetchDepartmentRows } from '@/lib/api/org';
import { fetchServices } from '@/lib/api/services';
import { fetchStaff } from '@/lib/api/staff';
import { digitsOnly, formatPhone } from '@/lib/format';
import type { JumpTarget, NavIconKey } from '@/lib/nav';
import { can, canOrg } from '@/lib/permissions';
import type { User } from '@/lib/types';

/** Một bản ghi khớp ô tìm — nhảy tới đúng trang chi tiết đã có. */
export type JumpHit = JumpTarget & {
  /** Dòng phụ: SĐT, số TK, mã đơn, mã nhân viên. */
  detail?: string;
  /** Phân biệt hai kết quả trùng href (dịch vụ và khách cùng một hồ sơ). */
  key: string;
};

export type JumpSource =
  | 'customers'
  | 'banking'
  | 'insurance'
  | 'services'
  | 'departments'
  | 'staff';

/** Ô trống hoặc một chữ thì chỉ lọc việc/màn, không hỏi kho. */
export function shouldSearchRecords(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  const digits = digitsOnly(q);
  if (digits.length >= 3 && digits.length === q.replace(/\s/g, '').length) return true;
  return q.length >= 2;
}

/** Module nào người này tra được — cùng cửa với sidebar và ô tìm trên từng màn. */
export function jumpSourcesFor(user: User | null): JumpSource[] {
  if (!user) return [];
  const sources: JumpSource[] = ['customers'];
  if (can(user, 'banking', 'view-detail')) sources.push('banking');
  if (can(user, 'insurance', 'view-detail')) sources.push('insurance');
  if (can(user, 'services', 'view-detail')) sources.push('services');
  if (canOrg(user, 'view-detail')) sources.push('departments');
  if (can(user, 'staff', 'view-detail')) sources.push('staff');
  return sources;
}

const hit = (
  key: string,
  href: string,
  label: string,
  icon: NavIconKey,
  group: string,
  detail?: string,
): JumpHit => ({ key, href, label, icon, group, detail });

export function jumpHitsFromCustomers(rows: CustomerLookupRow[]): JumpHit[] {
  return rows.map((r) =>
    hit(
      `customer:${r.id}`,
      `/customers/${r.id}`,
      r.fullName,
      'customers',
      'Khách hàng',
      r.primaryPhone ? formatPhone(r.primaryPhone) : undefined,
    ),
  );
}

export function jumpHitsFromBanking(
  rows: {
    id: string;
    customerName: string;
    bankCode: string;
    accountNumber: string;
    referralCodeText: string;
  }[],
): JumpHit[] {
  return rows.map((r) => {
    const code = r.accountNumber || r.referralCodeText;
    const detail = [r.bankCode, code].filter(Boolean).join(' · ');
    return hit(`banking:${r.id}`, `/banking/${r.id}`, r.customerName, 'banking', 'Ngân hàng', detail);
  });
}

export function jumpHitsFromInsurance(
  rows: { id: string; customerName: string; orderCode: string }[],
): JumpHit[] {
  return rows.map((r) =>
    hit(`insurance:${r.id}`, `/insurance/${r.id}`, r.customerName, 'insurance', 'Bảo hiểm', r.orderCode),
  );
}

export function jumpHitsFromServices(
  rows: {
    id: string;
    customerId: string;
    customerName: string;
    serviceTypeName: string;
  }[],
): JumpHit[] {
  return rows.map((r) =>
    hit(
      `service:${r.id}`,
      `/customers/${r.customerId}`,
      r.customerName,
      'services',
      'Dịch vụ',
      r.serviceTypeName,
    ),
  );
}

export function jumpHitsFromDepartments(rows: { id: string; name: string }[]): JumpHit[] {
  return rows.map((r) =>
    hit(`department:${r.id}`, `/departments/${r.id}`, r.name, 'org', 'Phòng ban'),
  );
}

export function jumpHitsFromStaff(
  rows: { id: string; fullName: string; staffCode: string | null; title: string }[],
): JumpHit[] {
  return rows.map((r) =>
    hit(
      `staff:${r.id}`,
      `/users/${r.id}`,
      r.fullName,
      'people',
      'Nhân sự',
      r.staffCode || r.title,
    ),
  );
}

const PAGE0 = { page: 0, dir: 'desc' as const };

async function hitsOf(source: JumpSource, query: string): Promise<JumpHit[]> {
  switch (source) {
    case 'customers':
      return jumpHitsFromCustomers((await fetchCustomerLookup(query)).rows);
    case 'banking':
      return jumpHitsFromBanking(
        (
          await fetchBankAccounts({
            ...PAGE0,
            sort: 'date',
            search: query,
            bankCode: '',
            from: '',
            to: '',
            referralCode: '',
            channelId: '',
            staffId: '',
            departmentId: '',
            status: '',
            accountType: '',
            photoCheck: '',
          })
        ).rows,
      );
    case 'insurance':
      return jumpHitsFromInsurance(
        (
          await fetchInsuranceOrders({
            ...PAGE0,
            sort: 'date',
            search: query,
            status: '',
            product: '',
            from: '',
            to: '',
            staffId: '',
            staffRole: 'any',
            departmentId: '',
            handler: '',
          })
        ).rows,
      );
    case 'services':
      return jumpHitsFromServices(
        (
          await fetchServices({
            ...PAGE0,
            sort: 'date',
            search: query,
            serviceTypeId: '',
            from: '',
            to: '',
            departmentId: '',
            wardId: '',
            staffId: '',
          })
        ).rows,
      );
    case 'departments':
      return jumpHitsFromDepartments((await fetchDepartmentRows(query)).departments);
    case 'staff':
      return jumpHitsFromStaff(
        (
          await fetchStaff({
            page: 0,
            sort: 'name',
            dir: 'asc',
            scope: '',
            departmentId: '',
            search: query,
            summaryMonth: '',
            from: '',
            to: '',
            status: 'active',
            roles: [],
          })
        ).page.rows,
      );
  }
}

/** Gọi đúng API từng màn đang dùng. Một nguồn hỏng thì bỏ, không kéo cả ô tìm. */
export async function fetchJumpHits(sources: JumpSource[], query: string): Promise<JumpHit[]> {
  const settled = await Promise.allSettled(sources.map((source) => hitsOf(source, query)));
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
