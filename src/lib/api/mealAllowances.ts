import { z } from 'zod';
import { pageOf, pageParams, type PageQuery } from './pagination';

/** Tháng đầu tiên có lương ăn ca (chủ dự án chốt 2026-11-20). Tháng trước đó ăn ca trả cùng lương tháng. */
export const MEAL_START_MONTH = '2026-11';

/** Chữ "tháng 11/2026" của tháng danh sách, cũng là tháng lương bị trừ khoản ăn ca đã chi. */
export const mealMonthLabel = (month: string): string => {
  const [y, m] = month.split('-');
  return `tháng ${Number(m)}/${y}`;
};

export const MealStatus = z.enum(['pending', 'head-approved', 'forwarded', 'approved', 'rejected', 'processing', 'paid']);
export type MealStatus = z.infer<typeof MealStatus>;

export const MEAL_STATUS_LABEL: Record<MealStatus, string> = {
  pending: 'Chờ Trưởng phòng duyệt',
  'head-approved': 'Trưởng phòng đã duyệt',
  forwarded: 'Trưởng phòng không duyệt',
  approved: 'Kế toán đã duyệt',
  rejected: 'Không chi riêng',
  processing: 'Đang xử lý',
  paid: 'Đã chi ăn ca',
};

export const MealEventKind = z.enum(['create', 'edit', 'head-approve', 'forward', 'approve', 'reject', 'processing', 'paid']);
export type MealEventKind = z.infer<typeof MealEventKind>;

export const MEAL_EVENT_LABEL: Record<MealEventKind, string> = {
  create: 'App lập dòng',
  edit: 'Sửa số ngày',
  'head-approve': 'Trưởng phòng duyệt',
  forward: 'Trưởng phòng không duyệt',
  approve: 'Kế toán duyệt',
  reject: 'Không chi riêng',
  processing: 'Chuyển sang Đang xử lý',
  paid: 'Đã chi ăn ca',
};

/**
 * Mốc của một tháng ăn ca, máy chủ tính theo giờ Việt Nam: `before` trước ngày
 * cuối tháng, `head-review` trong ngày cuối tháng, `accounting` từ 00:00 ngày 1
 * tháng sau.
 */
export const MealPhase = z.enum(['before', 'head-review', 'accounting']);
export type MealPhase = z.infer<typeof MealPhase>;

export const MealEvent = z.object({
  id: z.string(),
  kind: MealEventKind,
  at: z.string(),
  /** Chuỗi rỗng = app tự làm. */
  actorName: z.string(),
  actorTitle: z.string(),
  fromDays: z.number().nullable(),
  toDays: z.number().nullable(),
  note: z.string(),
});
export type MealEvent = z.infer<typeof MealEvent>;

export const MealDetail = z.object({
  id: z.string(),
  month: z.string(),
  fullName: z.string(),
  days: z.number(),
  amount: z.number(),
  status: MealStatus,
  rejectReason: z.string(),
  events: z.array(MealEvent),
});
export type MealDetail = z.infer<typeof MealDetail>;

export const MealRow = z.object({
  id: z.string(),
  userId: z.string(),
  fullName: z.string(),
  staffCode: z.string(),
  title: z.string(),
  departmentName: z.string(),
  /** Đã nghỉ cuối tháng: người duyệt kiểm lại số ngày. */
  left: z.boolean(),
  /** Số ngày công lương đang dùng, đã cắt trần. `null` khi người này không còn dòng ăn ca trong lương tháng. */
  appDays: z.number().nullable(),
  /** Số người duyệt nhập tay; `null` = chưa ai sửa. */
  editedDays: z.number().nullable(),
  /** Số ngày đang hiện: số đã khoá, không thì số người duyệt sửa, không thì số app tính. */
  days: z.number(),
  /** Trần số ngày nhập được. */
  maxDays: z.number(),
  amount: z.number(),
  status: MealStatus,
  rejectReason: z.string(),
  canEdit: z.boolean(),
  canApprove: z.boolean(),
  canReject: z.boolean(),
});
export type MealRow = z.infer<typeof MealRow>;

/**
 * `head`: Trưởng phòng xem dòng của phòng mình. `accounting`: kế toán xem cả công
 * ty từ ngày 1 tháng sau. `waiting`: kế toán mở trang trước mốc đó.
 */
export const MealListMode = z.enum(['head', 'accounting', 'waiting']);
export type MealListMode = z.infer<typeof MealListMode>;

export const MealList = z.object({
  month: z.string(),
  phase: MealPhase,
  mode: MealListMode,
  companyWide: z.boolean(),
  monthClosed: z.boolean(),
  /** Đơn giá một ngày của kỳ lương tháng này. */
  rate: z.number(),
  page: pageOf(MealRow),
  /**
   * Số dòng của cả tháng trong phạm vi, cho các nút. `headPending` và `waiting`
   * không tính dòng của chính người xem; `unapproved` có tính.
   */
  counts: z.object({
    headPending: z.number(),
    waiting: z.number(),
    unapproved: z.number(),
    approved: z.number(),
    processing: z.number(),
  }),
});
export type MealList = z.infer<typeof MealList>;

export const MEAL_SORTS = ['name', 'department'] as const;
export type MealSort = (typeof MEAL_SORTS)[number];

export type MealQuery = PageQuery<MealSort> & {
  /** Rỗng = máy chủ chọn tháng mặc định theo người xem. */
  month: string;
  search: string;
  status: MealStatus | '';
  departmentId: string;
};

export const MealExportRow = z.object({
  id: z.string(),
  fullName: z.string(),
  staffCode: z.string(),
  title: z.string(),
  departmentName: z.string(),
  days: z.number(),
  rate: z.number(),
  amount: z.number(),
  bankAccountNumber: z.string(),
  bankName: z.string(),
  bankCode: z.string(),
});
export type MealExportRow = z.infer<typeof MealExportRow>;

export const MealDaysForm = z.object({
  days: z
    .number()
    .min(0, 'Số ngày không âm.')
    .max(31, 'Tối đa 31 ngày.')
    .refine((d) => Number.isInteger(d * 2), 'Số ngày theo bước 0,5.'),
});

export const MealActionForm = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1, 'Nhập lý do không chi.').max(500) }),
]);
export type MealActionForm = z.infer<typeof MealActionForm>;

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const MealBatchForm = z.object({
  action: z.enum(['head-approve-all', 'approve-all', 'processing', 'paid']),
  month: Month,
});
export type MealBatchForm = z.infer<typeof MealBatchForm>;

async function failMessage(res: Response, fallback: string): Promise<never> {
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  throw new Error(data?.message?.trim() || fallback);
}

const send = (url: string, method: string, body: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchMeals(query: MealQuery): Promise<MealList> {
  const qs = pageParams(query, {
    month: query.month,
    search: query.search,
    status: query.status,
    departmentId: query.departmentId,
  });
  const res = await fetch(`/api/meal-allowances?${qs}`);
  if (!res.ok) await failMessage(res, 'Không tải được danh sách ăn ca');
  return MealList.parse(await res.json());
}

export async function fetchMeal(id: string): Promise<MealDetail> {
  const res = await fetch(`/api/meal-allowances/${encodeURIComponent(id)}`);
  if (!res.ok) await failMessage(res, 'Không tải được dòng ăn ca');
  return MealDetail.parse(await res.json());
}

export async function updateMealDays(id: string, days: number): Promise<void> {
  const res = await send(`/api/meal-allowances/${encodeURIComponent(id)}`, 'PATCH', { days });
  if (!res.ok) await failMessage(res, 'Không lưu được số ngày');
}

export async function actOnMeal(id: string, form: MealActionForm): Promise<void> {
  const res = await send(`/api/meal-allowances/${encodeURIComponent(id)}`, 'POST', form);
  if (!res.ok) await failMessage(res, form.action === 'approve' ? 'Không duyệt được' : 'Không cập nhật được');
}

export async function batchMeals(form: MealBatchForm): Promise<number> {
  const res = await send('/api/meal-allowances/batch', 'POST', form);
  if (!res.ok) await failMessage(res, 'Không cập nhật được các dòng ăn ca');
  return z.object({ count: z.number() }).parse(await res.json()).count;
}

export async function fetchMealExport(
  query: Pick<MealQuery, 'month' | 'search' | 'departmentId'>,
): Promise<MealExportRow[]> {
  const params = new URLSearchParams({ month: query.month });
  if (query.search) params.set('search', query.search);
  if (query.departmentId) params.set('departmentId', query.departmentId);
  const res = await fetch(`/api/meal-allowances/export?${params}`);
  if (!res.ok) await failMessage(res, 'Không tải được danh sách để xuất');
  return z.array(MealExportRow).parse(await res.json());
}
