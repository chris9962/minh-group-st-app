import { z } from 'zod';
import { pageOf, pageParams, type PageQuery } from './pagination';

/** Trần một yêu cầu tạm ứng, 50% lương căn bản (chốt 2026-11-01). */
export const ADVANCE_MAX = 3_000_000;
/** Ngày trong tháng nhân viên gửi yêu cầu. Trưởng phòng duyệt tới hết ngày này. */
export const ADVANCE_DAY = 10;
/** Giờ cuối nhân viên gửi hoặc sửa yêu cầu trong ngày 10. */
export const ADVANCE_SUBMIT_CLOSE_HOUR = 22;

export const AdvanceStatus = z.enum([
  'pending',
  'head-approved',
  'head-rejected',
  'expired',
  'approved',
  'rejected',
  'processing',
  'paid',
]);
export type AdvanceStatus = z.infer<typeof AdvanceStatus>;

export const ADVANCE_STATUS_LABEL: Record<AdvanceStatus, string> = {
  pending: 'Chờ Trưởng phòng duyệt',
  'head-approved': 'Trưởng phòng đã duyệt',
  'head-rejected': 'Trưởng phòng từ chối',
  expired: 'Hết hạn duyệt',
  approved: 'Đã duyệt',
  rejected: 'Kế toán từ chối',
  processing: 'Đang xử lý',
  paid: 'Đã chi tạm ứng',
};

export const AdvanceEventKind = z.enum([
  'create',
  'edit',
  'head-approve',
  'head-reject',
  'expire',
  'approve',
  'reject',
  'processing',
  'paid',
]);
export type AdvanceEventKind = z.infer<typeof AdvanceEventKind>;

export const ADVANCE_EVENT_LABEL: Record<AdvanceEventKind, string> = {
  create: 'Gửi yêu cầu',
  edit: 'Sửa số tiền',
  'head-approve': 'Trưởng phòng duyệt',
  'head-reject': 'Trưởng phòng từ chối',
  expire: 'Hết hạn duyệt',
  approve: 'Kế toán duyệt',
  reject: 'Kế toán từ chối',
  processing: 'Chuyển sang Đang xử lý',
  paid: 'Đã chi tạm ứng',
};

/**
 * Mốc của một tháng tạm ứng, máy chủ tính theo giờ Việt Nam:
 * `before` trước ngày 10, `submit` ngày 10 trước 22:00, `head-review` ngày 10
 * từ 22:00, `accounting` từ 00:00 ngày 11.
 */
export const AdvancePhase = z.enum(['before', 'submit', 'head-review', 'accounting']);
export type AdvancePhase = z.infer<typeof AdvancePhase>;

export const AdvanceEvent = z.object({
  id: z.string(),
  kind: AdvanceEventKind,
  at: z.string(),
  /** Chuỗi rỗng = app tự làm. */
  actorName: z.string(),
  actorRole: z.string(),
  fromAmount: z.number().nullable(),
  toAmount: z.number().nullable(),
  note: z.string(),
});
export type AdvanceEvent = z.infer<typeof AdvanceEvent>;

export const AdvanceDetail = z.object({
  id: z.string(),
  month: z.string(),
  fullName: z.string(),
  amount: z.number(),
  status: AdvanceStatus,
  rejectReason: z.string(),
  events: z.array(AdvanceEvent),
});
export type AdvanceDetail = z.infer<typeof AdvanceDetail>;

export const MyAdvance = z.object({
  month: z.string(),
  phase: AdvancePhase,
  canCreate: z.boolean(),
  canEdit: z.boolean(),
  request: AdvanceDetail.nullable(),
});
export type MyAdvance = z.infer<typeof MyAdvance>;

export const AdvanceRow = z.object({
  id: z.string(),
  userId: z.string(),
  fullName: z.string(),
  staffCode: z.string(),
  departmentName: z.string(),
  amount: z.number(),
  /** Lương cuối cùng tạm tính của tháng: lương theo điểm gồm ăn ca, cộng thưởng, trừ khoản trừ và ứng trước. */
  currentSalary: z.number(),
  status: AdvanceStatus,
  rejectReason: z.string(),
  createdAt: z.string(),
  canEdit: z.boolean(),
  canApprove: z.boolean(),
  canReject: z.boolean(),
});
export type AdvanceRow = z.infer<typeof AdvanceRow>;

/**
 * `head`: Trưởng phòng xem yêu cầu của phòng mình. `accounting`: kế toán xem yêu
 * cầu Trưởng phòng đã duyệt của cả công ty, từ 00:00 ngày 11. `waiting`: kế
 * toán mở trang trước 00:00 ngày 11.
 */
export const AdvanceListMode = z.enum(['head', 'accounting', 'waiting']);
export type AdvanceListMode = z.infer<typeof AdvanceListMode>;

export const AdvanceList = z.object({
  month: z.string(),
  phase: AdvancePhase,
  mode: AdvanceListMode,
  /** Người xem thấy mọi phòng: kế toán, hoặc tài khoản toàn quyền ở bước Trưởng phòng. */
  companyWide: z.boolean(),
  monthClosed: z.boolean(),
  page: pageOf(AdvanceRow),
  /** Số yêu cầu của cả tháng trong phạm vi, cho ba nút của kế toán. `headApproved` không tính yêu cầu của chính người xem. */
  counts: z.object({ headApproved: z.number(), approved: z.number(), processing: z.number() }),
});
export type AdvanceList = z.infer<typeof AdvanceList>;

export const ADVANCE_SORTS = ['createdAt', 'name', 'department', 'amount'] as const;
export type AdvanceSort = (typeof ADVANCE_SORTS)[number];

export type AdvanceQuery = PageQuery<AdvanceSort> & {
  month: string;
  search: string;
  status: AdvanceStatus | '';
  departmentId: string;
};

export const AdvanceExportRow = z.object({
  id: z.string(),
  fullName: z.string(),
  staffCode: z.string(),
  departmentName: z.string(),
  amount: z.number(),
  status: AdvanceStatus,
  createdAt: z.string(),
});
export type AdvanceExportRow = z.infer<typeof AdvanceExportRow>;

export const AdvanceAmountForm = z.object({
  amount: z
    .number()
    .int()
    .positive('Nhập số tiền tạm ứng.')
    .max(ADVANCE_MAX, `Tối đa ${ADVANCE_MAX.toLocaleString('vi-VN')} đ.`),
});

export const AdvanceActionForm = z.discriminatedUnion('action', [
  /** `amount` là số tiền người duyệt đang thấy; máy chủ từ chối nếu số đó vừa đổi. */
  z.object({ action: z.literal('approve'), amount: z.number().int() }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(1, 'Nhập lý do từ chối.').max(500) }),
]);
export type AdvanceActionForm = z.infer<typeof AdvanceActionForm>;

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const AdvanceBatchForm = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve-all'), month: Month }),
  /** `amount` là số trong file đã xuất: dòng bị sửa số tiền sau lúc xuất thì không chuyển. */
  z.object({
    action: z.literal('processing'),
    month: Month,
    items: z.array(z.object({ id: z.string().uuid(), amount: z.number().int() })).max(5000),
  }),
  z.object({ action: z.literal('paid'), month: Month }),
]);
export type AdvanceBatchForm = z.infer<typeof AdvanceBatchForm>;

async function failMessage(res: Response, fallback: string): Promise<never> {
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  throw new Error(data?.message?.trim() || fallback);
}

const send = (url: string, method: string, body: unknown) =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchMyAdvance(): Promise<MyAdvance> {
  const res = await fetch('/api/salary-advances/mine');
  if (!res.ok) await failMessage(res, 'Không tải được yêu cầu tạm ứng');
  return MyAdvance.parse(await res.json());
}

export async function saveMyAdvance(amount: number, editing: boolean): Promise<MyAdvance> {
  const res = await send('/api/salary-advances/mine', editing ? 'PATCH' : 'POST', { amount });
  if (!res.ok) await failMessage(res, 'Không gửi được yêu cầu tạm ứng');
  return MyAdvance.parse(await res.json());
}

export async function fetchAdvances(query: AdvanceQuery): Promise<AdvanceList> {
  const qs = pageParams(query, {
    month: query.month,
    search: query.search,
    status: query.status,
    departmentId: query.departmentId,
  });
  const res = await fetch(`/api/salary-advances?${qs}`);
  if (!res.ok) await failMessage(res, 'Không tải được danh sách tạm ứng');
  return AdvanceList.parse(await res.json());
}

export async function fetchAdvance(id: string): Promise<AdvanceDetail> {
  const res = await fetch(`/api/salary-advances/${encodeURIComponent(id)}`);
  if (!res.ok) await failMessage(res, 'Không tải được yêu cầu tạm ứng');
  return AdvanceDetail.parse(await res.json());
}

export async function updateAdvanceAmount(id: string, amount: number): Promise<void> {
  const res = await send(`/api/salary-advances/${encodeURIComponent(id)}`, 'PATCH', { amount });
  if (!res.ok) await failMessage(res, 'Không lưu được số tiền');
}

export async function actOnAdvance(id: string, form: AdvanceActionForm): Promise<void> {
  const res = await send(`/api/salary-advances/${encodeURIComponent(id)}`, 'POST', form);
  if (!res.ok) await failMessage(res, form.action === 'approve' ? 'Không duyệt được' : 'Không từ chối được');
}

export async function batchAdvances(form: AdvanceBatchForm): Promise<number> {
  const res = await send('/api/salary-advances/batch', 'POST', form);
  if (!res.ok) await failMessage(res, 'Không cập nhật được các yêu cầu');
  return z.object({ count: z.number() }).parse(await res.json()).count;
}

export async function fetchAdvanceExport(
  query: Pick<AdvanceQuery, 'month' | 'search' | 'departmentId'>,
): Promise<AdvanceExportRow[]> {
  const params = new URLSearchParams({ month: query.month });
  if (query.search) params.set('search', query.search);
  if (query.departmentId) params.set('departmentId', query.departmentId);
  const res = await fetch(`/api/salary-advances/export?${params}`);
  if (!res.ok) await failMessage(res, 'Không tải được danh sách để xuất');
  return z.array(AdvanceExportRow).parse(await res.json());
}
