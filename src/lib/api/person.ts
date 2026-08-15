import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';
import { InsuranceOrderStatus } from './insuranceOrders';
import { pageOf, pageParams, SortDir, type Page } from './pagination';

/** Số liệu cho P-52 Xem theo một nhân viên. */

/** Một dòng = một tài khoản đã mở cho một khách. Một khách có thể có nhiều dòng. */
export const PersonAccount = z.object({
  id: z.string(),
  date: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  bankName: z.string(),
  referralCode: z.string(),
  channel: z.string(),
  appInstalled: z.boolean(),
  /** Loại đăng ký app. `none` khi khách chưa cài app. */
  accountType: z.enum(['none', 'CNKD', 'HKD']),
});
export type PersonAccount = z.infer<typeof PersonAccount>;

/** Một khách do người này lập hồ sơ trong kỳ. */
export const PersonCustomer = z.object({
  id: z.string(),
  /** Ngày lập hồ sơ, đã quy về giờ làm việc. */
  date: z.string(),
  fullName: z.string(),
  phone: z.string(),
  channel: z.string(),
  /** Hai cột đếm lưu sẵn của khách — xem `customers.account_count` ở db-design §9. */
  accountCount: z.number(),
  insuranceCount: z.number(),
});
export type PersonCustomer = z.infer<typeof PersonCustomer>;

export const PersonService = z.object({
  id: z.string(),
  date: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  serviceType: z.string(),
  /** Chỉ nhân viên phòng Dự án mới có xã; nơi khác để trống. */
  ward: z.string(),
  points: z.number(),
});
export type PersonService = z.infer<typeof PersonService>;

export const PersonInsurance = z.object({
  id: z.string(),
  date: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  /** BH tai nạn điện · BH xe máy. */
  product: InsuranceProduct,
  packageName: z.string(),
  status: InsuranceOrderStatus,
});
export type PersonInsurance = z.infer<typeof PersonInsurance>;

/** Một nguồn điểm — để trả lời "68/100 thì thiếu ở đâu". */
export const PointSource = z.object({
  label: z.string(),
  detail: z.string(),
  points: z.number(),
});
export type PointSource = z.infer<typeof PointSource>;

export const PersonDetail = z.object({
  id: z.string(),
  fullName: z.string(),
  username: z.string(),
  /** Mã nhân viên — null với những tài khoản có trước khi trường này ra đời. */
  staffCode: z.string().nullable(),
  phone: z.string(),
  departmentName: z.string(),
  /** Tháng vào làm, dạng YYYY-MM. */
  joinedMonth: z.string(),
  /** Tháng của phần điểm. Luôn là tháng, kể cả khi bảng đang xem theo ngày. */
  summaryMonth: z.string(),
  daysLeft: z.number(),
  points: z.object({
    banking: z.number(),
    service: z.number(),
    total: z.number(),
    target: z.number(),
  }),
  pointSources: z.array(PointSource),
  /** Điểm 5 tháng gần nhất, cũ trước mới sau. Luôn theo tháng, không theo ngày. */
  monthlyPoints: z.array(z.object({ month: z.string(), points: z.number() })),
  /**
   * Số bản ghi trong kỳ — cho ba thẻ đếm ở màn Tổng quan của nhân viên.
   * Danh sách chi tiết nằm ở bốn route phân trang riêng (chốt 2026-08-15).
   */
  counts: z.object({
    accounts: z.number(),
    insurance: z.number(),
    services: z.number(),
  }),
});
export type PersonDetail = z.infer<typeof PersonDetail>;

export async function fetchPerson(query: {
  id: string;
  period: string;
  summaryMonth: string;
}): Promise<PersonDetail> {
  const params = new URLSearchParams({
    period: query.period,
    summaryMonth: query.summaryMonth,
  });
  const res = await fetch(`/api/people/${encodeURIComponent(query.id)}?${params}`);
  if (res.status === 404) throw new Error('Không tìm thấy nhân viên này');
  if (!res.ok) throw new Error('Không tải được hồ sơ nhân viên');
  return PersonDetail.parse(await res.json());
}

/* ── Bốn danh sách hoạt động, mỗi tab một route phân trang (chốt 2026-08-15) ── */

export type PersonListQuery = {
  id: string;
  /** Khoảng NGÀY của kỳ, YYYY-MM-DD — tường minh, không gửi token kiểu "today". */
  from: string;
  to: string;
  /** Đếm từ 0. */
  page: number;
  dir: SortDir;
};

const personListPage = <T extends z.ZodTypeAny>(row: T, segment: string) => {
  const PageSchema = pageOf(row);
  return async (query: PersonListQuery): Promise<Page<z.infer<T>>> => {
    const qs = pageParams(
      { page: query.page, sort: 'date', dir: query.dir },
      { from: query.from, to: query.to },
    );
    const res = await fetch(`/api/people/${encodeURIComponent(query.id)}/${segment}?${qs}`);
    if (res.status === 404) throw new Error('Không tìm thấy nhân viên này');
    if (!res.ok) throw new Error('Không tải được danh sách hoạt động');
    return PageSchema.parse(await res.json());
  };
};

export const fetchPersonCustomers = personListPage(PersonCustomer, 'customers');
export const fetchPersonAccounts = personListPage(PersonAccount, 'accounts');
export const fetchPersonInsurance = personListPage(PersonInsurance, 'insurance');
export const fetchPersonServices = personListPage(PersonService, 'services');
