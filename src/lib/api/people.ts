import { z } from 'zod';
import type { Scope } from '@/lib/types';

/** Số liệu cho P-51 Danh sách nhân viên + điểm. */

/**
 * Kỳ xem bảng.
 *
 * `today` xem hoạt động trong ngày — KHÔNG có cột điểm và trạng thái, vì chỉ
 * tiêu tính theo tháng, điểm của một ngày không so được với chỉ tiêu nào.
 */
export type PeriodMode =
  | { kind: 'today' }
  | { kind: 'this-month' }
  | { kind: 'month'; month: string };

export const periodMonth = (p: PeriodMode, current: string): string =>
  p.kind === 'month' ? p.month : current;

export const showsKpi = (p: PeriodMode): boolean => p.kind !== 'today';

export const periodParam = (p: PeriodMode, current: string): string =>
  p.kind === 'today' ? 'today' : periodMonth(p, current);

export const PersonScore = z.object({
  id: z.string(),
  fullName: z.string(),
  /** Mã nhân viên — null với tài khoản có trước khi trường này ra đời. */
  staffCode: z.string().nullable(),
  departmentName: z.string(),
  /** Điểm từ ngân hàng: tổng hệ số của app đã cài + CNKD/HKD. */
  bankingPoints: z.number(),
  /** Điểm từ dịch vụ: hệ số theo loại dịch vụ. */
  servicePoints: z.number(),
  accounts: z.number(),
  apps: z.number(),
  insuranceOrders: z.number(),
  /** Chỉ tiêu của riêng người này — để sau còn đặt khác nhau được. */
  target: z.number(),
});
export type PersonScore = z.infer<typeof PersonScore>;

export const totalPoints = (p: { bankingPoints: number; servicePoints: number }) =>
  p.bankingPoints + p.servicePoints;

export type PeopleQuery = {
  scope: Scope;
  period: string;
  summaryMonth: string;
  departmentId: string;
  /** Tìm theo tên nhân viên, tên đăng nhập hoặc tên đơn vị. Không dấu cũng khớp. */
  search: string;
};

/**
 * TRỌN danh sách khớp bộ lọc, CHỈ cho việc xuất Excel.
 *
 * Màn P-51 không dùng hàm này: bảng ở đó lấy đúng một trang qua `fetchStaff`.
 * Ba cột đếm (`accounts`, `apps`, `insuranceOrders`) chỉ còn sống trong file
 * Excel, nên phép gộp trên kho tài khoản giờ chạy một lượt mỗi lần bấm xuất,
 * thay vì mỗi lần gõ phím.
 *
 * Không có trần số dòng nên cũng không có chuyện file bị cắt âm thầm — số dòng
 * ở đây bằng số nhân viên công ty, không lớn thêm theo ngày làm việc.
 */
export async function fetchPeopleForExport(query: PeopleQuery): Promise<PersonScore[]> {
  const params = new URLSearchParams({
    scope: query.scope,
    period: query.period,
    summaryMonth: query.summaryMonth,
    departmentId: query.departmentId,
    search: query.search,
  });
  const res = await fetch(`/api/people/export?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách nhân viên');
  return z.array(PersonScore).parse(await res.json());
}
