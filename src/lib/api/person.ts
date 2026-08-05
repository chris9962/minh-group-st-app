import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';
import { InsuranceOrderStatus } from './insuranceOrders';

/** Số liệu cho P-52 Xem theo một nhân viên. */

/** Một dòng = một tài khoản đã mở cho một khách. Một khách có thể có nhiều dòng. */
export const PersonAccount = z.object({
  id: z.string(),
  date: z.string(),
  customerName: z.string(),
  bankName: z.string(),
  referralCode: z.string(),
  channel: z.string(),
  appInstalled: z.boolean(),
  /** Loại đăng ký app. `none` khi khách chưa cài app. */
  accountType: z.enum(['none', 'CNKD', 'HKD']),
});
export type PersonAccount = z.infer<typeof PersonAccount>;

/** Quà của một khách. Quà tính theo KHÁCH, không theo từng tài khoản. */
export const CustomerGift = z.object({
  customerName: z.string(),
  /** Món đã phát. Rỗng mà `eligible` là đúng nghĩa là đủ điều kiện nhưng chưa phát. */
  items: z.array(z.string()),
  eligible: z.boolean(),
});
export type CustomerGift = z.infer<typeof CustomerGift>;

/** Một khách với TẤT CẢ ngân hàng của họ gộp lại. */
export type CustomerAccounts = {
  customerName: string;
  /** Ngày gần nhất trong nhóm — để sắp xếp. */
  date: string;
  banks: string[];
  referralCodes: string[];
  channels: string[];
  /** Ngân hàng đã cài app, kèm loại đăng ký: `VPa (CNKD)`. */
  appBanks: string[];
  giftItems: string[];
  giftEligible: boolean;
};

/**
 * Gộp tài khoản thành một hàng cho mỗi khách.
 *
 * Một khách mở tài khoản ở nhiều ngân hàng, để mỗi ngân hàng một dòng thì tên
 * khách lặp lại và người đọc phải tự gom. Xuất Excel cũng gộp theo đúng quy tắc
 * này, nên hàm để ở đây chứ không nằm trong trang.
 */
export function groupAccountsByCustomer(
  accounts: PersonAccount[],
  gifts: CustomerGift[] = [],
): CustomerAccounts[] {
  const giftOf = new Map(gifts.map((g) => [g.customerName, g]));
  const byCustomer = new Map<string, CustomerAccounts>();

  for (const a of accounts) {
    const row = byCustomer.get(a.customerName) ?? {
      customerName: a.customerName,
      date: a.date,
      banks: [],
      referralCodes: [],
      channels: [],
      appBanks: [],
      giftItems: giftOf.get(a.customerName)?.items ?? [],
      giftEligible: giftOf.get(a.customerName)?.eligible ?? false,
    };

    // Chuỗi YYYY-MM-DD so sánh được trực tiếp, không cần dựng Date.
    if (a.date > row.date) row.date = a.date;
    if (!row.banks.includes(a.bankName)) row.banks.push(a.bankName);
    if (!row.referralCodes.includes(a.referralCode))
      row.referralCodes.push(a.referralCode);
    if (!row.channels.includes(a.channel)) row.channels.push(a.channel);
    if (a.appInstalled) {
      row.appBanks.push(
        a.accountType === 'none' ? a.bankName : `${a.bankName} (${a.accountType})`,
      );
    }

    byCustomer.set(a.customerName, row);
  }

  return [...byCustomer.values()];
}

export const PersonService = z.object({
  id: z.string(),
  date: z.string(),
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
  /** Quà đã tặng cho khách của người này trong kỳ. */
  gifts: z.array(CustomerGift),
  /** Rỗng thì trang không hiện thẻ tương ứng. */
  accounts: z.array(PersonAccount),
  insurance: z.array(PersonInsurance),
  services: z.array(PersonService),
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
