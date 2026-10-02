import { z } from 'zod';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * Tích hợp VNeID (chốt 2026-10-02) — module riêng, KHÔNG tính điểm KPI và
 * không dính tới `services`. Mỗi dòng là một lượt làm cho một khách. Ngày thực
 * hiện là giờ tạo `created_at`: hiện, lọc, sắp đều theo cột đó.
 */

/** Ba việc làm cho khách. Thứ tự này là thứ tự ô đánh dấu, cột bảng và cột Excel. */
export const VNEID_TASKS = [
  { key: 'healthInsurance', label: 'BHYT' },
  { key: 'socialWelfare', label: 'ASXH' },
  { key: 'digitalSignature', label: 'Chữ ký số' },
] as const;
export type VneidTaskKey = (typeof VNEID_TASKS)[number]['key'];

export const MAX_VNEID_PHOTOS = 4;

export const VneidRow = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  customerAddress: z.string(),
  healthInsurance: z.boolean(),
  socialWelfare: z.boolean(),
  digitalSignature: z.boolean(),
  /** `/api/images/<key>` của từng ảnh. */
  photoUrls: z.array(z.string()),
  note: z.string(),
  createdById: z.string(),
  createdByName: z.string(),
  createdByCode: z.string().nullable(),
  createdByDepartmentId: z.string().nullable(),
  /** Phòng ghi nhận lượt này, chụp lúc tạo; nhân viên chuyển phòng thì dời theo từ đầu tháng. */
  createdByDepartmentName: z.string().nullable(),
  /** Giờ tạo, ISO. Cũng là ngày thực hiện. */
  createdAt: z.string(),
  /** Tháng của hồ sơ khách đã chốt lương: không thêm, sửa, xoá được nữa. */
  monthClosed: z.boolean(),
});
export type VneidRow = z.infer<typeof VneidRow>;

/** Danh sách trắng cho `ORDER BY` — chỉ cột của chính bảng `vneid_records` (AGENTS.md §5.2). */
export const VNEID_SORT = ['createdAt'] as const;
export type VneidSort = (typeof VNEID_SORT)[number];

export type VneidFilters = {
  /** Tìm theo TÊN KHÁCH. */
  search: string;
  /** Khoảng ngày tạo `YYYY-MM-DD`, theo giờ Việt Nam. */
  from: string;
  to: string;
  departmentId: string;
  staffId: string;
  /** Khối VNeID ở hồ sơ khách. */
  customerId: string;
  /** Chỉ những lượt có đánh dấu việc này. `''` = không lọc. */
  task: VneidTaskKey | '';
};
export type VneidQuery = PageQuery<VneidSort> & VneidFilters;

const VneidPage = pageOf(VneidRow);

const filterParams = (query: VneidFilters) => ({
  search: query.search,
  from: query.from,
  to: query.to,
  departmentId: query.departmentId,
  staffId: query.staffId,
  customerId: query.customerId,
  task: query.task,
});

export async function fetchVneidRecords(query: VneidQuery): Promise<Page<VneidRow>> {
  const res = await fetch(`/api/vneid?${pageParams(query, filterParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách VNeID');
  return VneidPage.parse(await res.json());
}

/** TRỌN danh sách khớp bộ lọc, CHỈ cho xuất Excel. `total` lớn hơn số dòng khi chạm trần. */
export async function fetchVneidForExport(query: VneidFilters): Promise<Page<VneidRow>> {
  const res = await fetch(`/api/vneid/export?${new URLSearchParams(filterParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách VNeID');
  return VneidPage.parse(await res.json());
}

const baseFields = {
  customerId: z.guid('Chưa chọn khách'),
  healthInsurance: z.boolean(),
  socialWelfare: z.boolean(),
  digitalSignature: z.boolean(),
  /** URL ảnh sau khi tải lên kho. Không bắt buộc. */
  photoUrls: z.array(z.string().trim()).max(MAX_VNEID_PHOTOS),
  note: z.string().trim(),
  /** Phòng ghi nhận — chỉ người không thuộc phòng nào mới phải chọn. */
  departmentId: z.string(),
};

const hasTask = (f: { healthInsurance: boolean; socialWelfare: boolean; digitalSignature: boolean }) =>
  f.healthInsurance || f.socialWelfare || f.digitalSignature;
const hasTaskIssue = { message: 'Chưa đánh dấu việc nào', path: ['healthInsurance'] };

export const VneidForm = z.object(baseFields).refine(hasTask, hasTaskIssue);
export type VneidForm = z.infer<typeof VneidForm>;

/** Khách, người làm và phòng không sửa được — đổi chúng là biến lượt này thành việc khác. */
export const VneidEditForm = z
  .object({
    healthInsurance: baseFields.healthInsurance,
    socialWelfare: baseFields.socialWelfare,
    digitalSignature: baseFields.digitalSignature,
    photoUrls: baseFields.photoUrls,
    note: baseFields.note,
  })
  .refine(hasTask, hasTaskIssue);
export type VneidEditForm = z.infer<typeof VneidEditForm>;

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message?.trim() || fallback);
}

export async function createVneidRecord(form: VneidForm): Promise<VneidRow> {
  const res = await fetch('/api/vneid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được lượt VNeID này');
  return VneidRow.parse(await res.json());
}

export async function updateVneidRecord(id: string, form: VneidEditForm): Promise<VneidRow> {
  const res = await fetch(`/api/vneid/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được thay đổi này');
  return VneidRow.parse(await res.json());
}

export async function deleteVneidRecord(id: string): Promise<void> {
  const res = await fetch(`/api/vneid/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'Không xoá được lượt VNeID này');
}
