import { z } from 'zod';
import { removeDiacritics } from '@/lib/format';
import { formatCents } from '@/lib/money';
import type { ColumnSpec } from '@/lib/readExcelRows';
import { pageParams, type PageQuery } from './pagination';

/**
 * Trang BHYT/BHXH của Phòng An Sinh (docs/spec-bhyt-bhxh-an-sinh.md, chốt
 * 2026-10-04). Tiền đi qua API bằng ĐỒNG × 100 (số nguyên), % bằng đơn vị
 * 0,001%, xem `lib/money.ts`.
 */

export const SocialInsuranceKind = z.enum(['bhyt', 'bhxh']);
export type SocialInsuranceKind = z.infer<typeof SocialInsuranceKind>;

export const KIND_LABEL: Record<SocialInsuranceKind, string> = { bhyt: 'BHYT', bhxh: 'BHXH' };

export const SocialInsurancePlan = z.enum(['new', 'renewal']);
export type SocialInsurancePlan = z.infer<typeof SocialInsurancePlan>;

export const PLAN_LABEL: Record<SocialInsurancePlan, string> = { new: 'Tăng mới', renewal: 'Tái tục' };

export function parsePlan(raw: string): SocialInsurancePlan | null {
  const v = removeDiacritics(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  if (v === 'tang moi') return 'new';
  if (v === 'tai tuc') return 'renewal';
  return null;
}

/** Bảng `service_types` không có mã, nên so theo tên, cùng cách `PHOTO_SERVICE_TYPES`. */
export const DATA_ENTRY_TYPE_NAME: Record<SocialInsuranceKind, string> = {
  bhyt: 'Nhập liệu BHYT',
  bhxh: 'Nhập liệu BHXH',
};
export const DATA_ENTRY_TYPE_NAMES: readonly string[] = Object.values(DATA_ENTRY_TYPE_NAME);

export const RECORD_FILE_COLUMNS = {
  receiptDate: { headers: ['NGÀY BIÊN LAI'], required: true },
  fullName: { headers: ['HỌ VÀ TÊN', 'HỌ TÊN'], required: true, anchor: true, endsAtTotal: true },
  idNumber: { headers: ['CCCD'], required: true, anchor: true },
  address: { headers: ['ĐỊA CHỈ'], required: true },
  socialInsuranceCode: { headers: ['MÃ SỐ BHXH', 'MÃ BHXH'], required: true },
  plan: { headers: ['PHƯƠNG ÁN'], required: true },
  months: { headers: ['SỐ THÁNG'], required: true },
  collected: { headers: ['SỐ TIỀN THU'], required: true },
  paid: { headers: ['SỐ TIỀN CHI'], required: true },
  staffCode: { headers: ['NHẬP LIỆU'], required: true },
  collaborator: { headers: ['CTV'], required: true },
} satisfies ColumnSpec<string>;

export const RECONCILE_FILE_COLUMNS = {
  receiptDate: { headers: ['NGÀY BIÊN LAI'], required: true },
  fullName: { headers: ['HỌ VÀ TÊN', 'HỌ TÊN'], required: false, anchor: true, endsAtTotal: true },
  identity: { headers: ['CCCD/BHXH', 'CCCD', 'MÃ SỐ BHXH'], required: true, anchor: true },
  plan: { headers: ['PHƯƠNG ÁN'], required: true },
  months: { headers: ['SỐ THÁNG'], required: true },
  collected: { headers: ['SỐ TIỀN THU'], required: true },
  received: { headers: ['SỐ TIỀN NHẬN'], required: true },
  receivedRate: { headers: ['% HH NHẬN', 'HH NHẬN'], required: true, rate: true },
} satisfies ColumnSpec<string>;

const cell = z.string().max(500);

export const RecordFileRow = z.object({
  row: z.number().int(),
  receiptDate: cell,
  fullName: cell,
  idNumber: cell,
  address: cell,
  socialInsuranceCode: cell,
  plan: cell,
  months: cell,
  collected: cell,
  paid: cell,
  staffCode: cell,
  collaborator: cell,
});
export type RecordFileRow = z.infer<typeof RecordFileRow>;

export const ReconcileFileRow = z.object({
  row: z.number().int(),
  receiptDate: cell,
  fullName: cell.default(''),
  identity: cell,
  plan: cell,
  months: cell,
  collected: cell,
  received: cell,
  receivedRate: cell,
});
export type ReconcileFileRow = z.infer<typeof ReconcileFileRow>;

/** Trần một lượt tải: cả file ghi trong một transaction. */
export const IMPORT_MAX_ROWS = 3000;

export const RecordImportRequest = z.object({
  kind: SocialInsuranceKind,
  /** Tỉnh đang triển khai: cột ĐỊA CHỈ chỉ ghi xã, mà tên xã lặp lại giữa các tỉnh. */
  provinceId: z.string().min(1, 'Chưa chọn tỉnh/thành phố'),
  rows: z.array(RecordFileRow).min(1).max(IMPORT_MAX_ROWS),
  commit: z.boolean(),
});
export type RecordImportRequest = z.infer<typeof RecordImportRequest>;

export const ReconcileImportRequest = z.object({
  kind: SocialInsuranceKind,
  rows: z.array(ReconcileFileRow).min(1).max(IMPORT_MAX_ROWS),
  commit: z.boolean(),
});
export type ReconcileImportRequest = z.infer<typeof ReconcileImportRequest>;

export const RecordPreviewRow = z.object({
  row: z.number(),
  fullName: z.string(),
  /** 4 số cuối CCCD, cùng luật che CCCD của mọi response khác. */
  idNumberTail: z.string(),
  receiptMonth: z.string(),
  customer: z.enum(['existing', 'new']).nullable(),
  wardName: z.string(),
  staffName: z.string(),
  plan: SocialInsurancePlan.nullable(),
  months: z.number().nullable(),
  collectedCents: z.number().nullable(),
  paidCents: z.number().nullable(),
  /** Mọi lỗi của dòng. Rỗng = dòng hợp lệ. */
  errors: z.array(z.string()),
});
export type RecordPreviewRow = z.infer<typeof RecordPreviewRow>;

export const ReconcilePreviewRow = z.object({
  row: z.number(),
  fullName: z.string(),
  /** 4 số cuối khi là CCCD, nguyên mã khi là mã số BHXH. */
  identity: z.string(),
  receiptMonth: z.string(),
  plan: SocialInsurancePlan.nullable(),
  months: z.number().nullable(),
  collectedCents: z.number().nullable(),
  receivedCents: z.number().nullable(),
  receivedRate: z.number().nullable(),
  errors: z.array(z.string()),
  /** Chỗ file 2 khác file 1. Không phải lỗi: vẫn lưu, trang tô ô lệch. */
  differences: z.array(z.string()),
});
export type ReconcilePreviewRow = z.infer<typeof ReconcilePreviewRow>;

export const RecordImportResult = z.object({ rows: z.array(RecordPreviewRow), written: z.number() });
export type RecordImportResult = z.infer<typeof RecordImportResult>;

export const ReconcileImportResult = z.object({ rows: z.array(ReconcilePreviewRow), written: z.number() });
export type ReconcileImportResult = z.infer<typeof ReconcileImportResult>;

export const Reconciliation = z.object({
  plan: SocialInsurancePlan,
  months: z.number(),
  collectedCents: z.number(),
  receivedCents: z.number(),
  receivedRate: z.number(),
  /**
   * Tiền chi tính lại theo phương án, số tháng, tiền thu của file đối chiếu và
   * % chi của tháng biên lai. `null` khi bộ đó chưa có % chi.
   */
  paidCents: z.number().nullable(),
  at: z.string(),
});
export type Reconciliation = z.infer<typeof Reconciliation>;

export const SocialInsuranceRow = z.object({
  id: z.string(),
  kind: SocialInsuranceKind,
  customerId: z.string(),
  customerName: z.string(),
  idNumberTail: z.string().nullable(),
  socialInsuranceCode: z.string().nullable(),
  receiptMonth: z.string(),
  plan: SocialInsurancePlan,
  months: z.number(),
  collectedCents: z.number(),
  paidCents: z.number(),
  collaboratorName: z.string().nullable(),
  entryStaffId: z.string(),
  entryStaffName: z.string(),
  entryStaffCode: z.string().nullable(),
  entryStaffDepartmentName: z.string().nullable(),
  /** Người tải file. Đặt tên `createdBy…` để dùng chung `recordInScope`. */
  createdById: z.string(),
  createdByName: z.string(),
  createdByCode: z.string().nullable(),
  createdByDepartmentId: z.string().nullable(),
  createdByDepartmentName: z.string().nullable(),
  createdAt: z.string(),
  reconciliation: Reconciliation.nullable(),
  /** Tháng biên lai hoặc tháng tải file đã chốt lương: không sửa, không xoá. */
  monthClosed: z.boolean(),
});
export type SocialInsuranceRow = z.infer<typeof SocialInsuranceRow>;

export const SocialInsuranceExportRow = SocialInsuranceRow.extend({ idNumber: z.string().nullable() });
export type SocialInsuranceExportRow = z.infer<typeof SocialInsuranceExportRow>;

export const ReconcileStatus = z.enum(['pending', 'matched', 'mismatch']);
export type ReconcileStatus = z.infer<typeof ReconcileStatus>;

export const RECONCILE_STATUS_LABEL: Record<ReconcileStatus, string> = {
  pending: 'Chưa đối chiếu',
  matched: 'Khớp',
  mismatch: 'Lệch',
};

export type SocialInsuranceFilters = {
  /** Tìm theo tên khách, CCCD hoặc mã số BHXH. */
  search: string;
  /** Khoảng ngày tạo (ngày tải file), `YYYY-MM-DD` theo giờ Việt Nam. Rỗng = không giới hạn. */
  from: string;
  to: string;
  kind: SocialInsuranceKind | '';
  plan: SocialInsurancePlan | '';
  collaboratorId: string;
  uploadedBy: string;
  entryStaffId: string;
  status: ReconcileStatus | '';
};

export const SOCIAL_INSURANCE_SORT = ['createdAt'] as const;
export type SocialInsuranceSort = (typeof SOCIAL_INSURANCE_SORT)[number];
export type SocialInsuranceQuery = PageQuery<SocialInsuranceSort> & SocialInsuranceFilters;

export const SocialInsuranceTotals = z.object({
  rows: z.number(),
  customers: z.number(),
  collectedCents: z.number(),
  paidCents: z.number(),
  receivedCents: z.number(),
  bhyt: z.number(),
  bhxh: z.number(),
  newCount: z.number(),
  renewalCount: z.number(),
});
export type SocialInsuranceTotals = z.infer<typeof SocialInsuranceTotals>;

export const SocialInsurancePage = z.object({
  rows: z.array(SocialInsuranceRow),
  total: z.number(),
  totals: SocialInsuranceTotals,
});
export type SocialInsurancePage = z.infer<typeof SocialInsurancePage>;

export const SocialInsuranceOptions = z.object({
  collaborators: z.array(z.object({ id: z.string(), name: z.string() })),
  uploaders: z.array(z.object({ id: z.string(), name: z.string() })),
  entryStaff: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Nhân viên Điểm ATM đang làm, cho ô chọn NV nhập liệu của form Sửa. */
  atmStaff: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullable() })),
});
export type SocialInsuranceOptions = z.infer<typeof SocialInsuranceOptions>;

/** Sửa một dòng: các ô giữ dạng chữ để máy chủ kiểm bằng đúng luật của file 1. */
export const RecordEditForm = z.object({
  receiptMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Chưa chọn tháng biên lai'),
  plan: SocialInsurancePlan,
  months: z.string().trim().min(1, 'Chưa nhập số tháng'),
  collected: z.string().trim().min(1, 'Chưa nhập số tiền thu'),
  paid: z.string().trim().min(1, 'Chưa nhập số tiền chi'),
  collaborator: z.string().trim().max(200),
  entryStaffId: z.string().trim().min(1, 'Chưa chọn nhân viên ATM'),
});
export type RecordEditForm = z.infer<typeof RecordEditForm>;

export type Difference = 'plan' | 'months' | 'collected' | 'paid';

/** Cột của file 1 khác file 2. Chưa đối chiếu thì rỗng. */
export function differencesOf(
  row: Pick<SocialInsuranceRow, 'plan' | 'months' | 'collectedCents' | 'paidCents' | 'reconciliation'>,
): Difference[] {
  const r = row.reconciliation;
  if (!r) return [];
  return [
    ...(r.plan !== row.plan ? (['plan'] as const) : []),
    ...(r.months !== row.months ? (['months'] as const) : []),
    ...(r.collectedCents !== row.collectedCents ? (['collected'] as const) : []),
    ...(r.paidCents !== null && r.paidCents !== row.paidCents ? (['paid'] as const) : []),
  ];
}

export const statusOf = (row: Parameters<typeof differencesOf>[0]): ReconcileStatus =>
  !row.reconciliation ? 'pending' : differencesOf(row).length > 0 ? 'mismatch' : 'matched';

/** Câu ghi chú cho cột GHI CHÚ của file xuất, ví dụ `Số tháng: hồ sơ ghi 6, đối chiếu ghi 12`. */
export function differenceNote(row: Parameters<typeof differencesOf>[0]): string {
  const r = row.reconciliation;
  if (!r) return 'Chưa đối chiếu';
  return differencesOf(row)
    .map((d) =>
      d === 'plan'
        ? `Phương án: hồ sơ ghi ${PLAN_LABEL[row.plan]}, đối chiếu ghi ${PLAN_LABEL[r.plan]}`
        : d === 'months'
          ? `Số tháng: hồ sơ ghi ${row.months}, đối chiếu ghi ${r.months}`
          : d === 'collected'
            ? `Tiền thu: hồ sơ ghi ${formatCents(row.collectedCents)}, đối chiếu ghi ${formatCents(r.collectedCents)}`
            : `Tiền chi: hồ sơ ghi ${formatCents(row.paidCents)}, đối chiếu tính ra ${formatCents(r.paidCents ?? 0)}`,
    )
    .join('; ');
}

/** Lỗi của form Sửa, kèm lỗi theo từng ô để hiện dưới đúng ô đó. */
export class RecordEditError extends Error {
  constructor(
    message: string,
    public fieldErrors: Partial<Record<keyof RecordEditForm, string>>,
  ) {
    super(message);
    this.name = 'RecordEditError';
  }
}

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    message?: string;
    fieldErrors?: Partial<Record<keyof RecordEditForm, string>>;
  } | null;
  const message = body?.message?.trim() || fallback;
  return body?.fieldErrors ? new RecordEditError(message, body.fieldErrors) : new Error(message);
}

const filterParams = (q: SocialInsuranceFilters) => ({
  search: q.search,
  from: q.from,
  to: q.to,
  kind: q.kind,
  plan: q.plan,
  collaboratorId: q.collaboratorId,
  uploadedBy: q.uploadedBy,
  entryStaffId: q.entryStaffId,
  status: q.status,
});

export async function fetchSocialInsurance(query: SocialInsuranceQuery): Promise<SocialInsurancePage> {
  const res = await fetch(`/api/social-insurance?${pageParams(query, filterParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách BHYT/BHXH');
  return SocialInsurancePage.parse(await res.json());
}

/** TRỌN danh sách khớp bộ lọc, CHỈ cho xuất Excel. `total` lớn hơn số dòng khi chạm trần. */
export async function fetchSocialInsuranceForExport(
  filters: SocialInsuranceFilters,
): Promise<{ rows: SocialInsuranceExportRow[]; total: number }> {
  const res = await fetch(`/api/social-insurance/export?${new URLSearchParams(filterParams(filters))}`);
  if (!res.ok) throw new Error('Không tải được danh sách BHYT/BHXH');
  return z.object({ rows: z.array(SocialInsuranceExportRow), total: z.number() }).parse(await res.json());
}

export async function fetchSocialInsuranceOptions(): Promise<SocialInsuranceOptions> {
  const res = await fetch('/api/social-insurance/options');
  if (!res.ok) throw new Error('Không tải được danh sách lọc');
  return SocialInsuranceOptions.parse(await res.json());
}

async function post<T>(url: string, body: unknown, schema: z.ZodType<T>, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, fallback);
  return schema.parse(await res.json());
}

export const importRecords = (request: RecordImportRequest) =>
  post('/api/social-insurance/import', request, RecordImportResult, 'Không nhập được file này');

export const importReconciliation = (request: ReconcileImportRequest) =>
  post('/api/social-insurance/reconcile', request, ReconcileImportResult, 'Không nhập được file này');

export async function updateRecord(id: string, form: RecordEditForm): Promise<SocialInsuranceRow> {
  const res = await fetch(`/api/social-insurance/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được thay đổi này');
  return SocialInsuranceRow.parse(await res.json());
}

export async function deleteRecord(id: string): Promise<void> {
  const res = await fetch(`/api/social-insurance/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'Không xoá được dòng này');
}
