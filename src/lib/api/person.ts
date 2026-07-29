import { z } from 'zod';

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
});
export type PersonAccount = z.infer<typeof PersonAccount>;

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
  product: z.string(),
  packageName: z.string(),
  status: z.enum(['done', 'running', 'manual']),
});
export type PersonInsurance = z.infer<typeof PersonInsurance>;

export const INSURANCE_STATUS: Record<PersonInsurance['status'], string> = {
  done: 'Hoàn thành',
  running: 'Đang chạy',
  manual: 'Chờ làm tay',
};

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
