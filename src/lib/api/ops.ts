import { z } from 'zod';
import { InsuranceOrderStatus } from '@/lib/api/insuranceOrders';
import { pageOf, pageParams, type Page, type PageQuery } from '@/lib/api/pagination';
import { InsuranceProduct } from '@/lib/types';

/**
 * P-99 · Vận hành hệ thống — màn của người quản trị, gác bằng `system:view-ops`.
 *
 * Ba khối, ba câu hỏi khác nhau, và không khối nào nói về kết quả kinh doanh:
 *
 *   1. Kiểm ảnh    hàng đợi còn bao nhiêu, mỗi ngân hàng đạt / không đạt bao nhiêu
 *   2. Bảo hiểm    đơn nào đang chờ giấy chứng nhận, chờ bao lâu rồi
 *   3. Máy chủ     CPU, RAM, ổ đĩa, S3 — thay cho việc mở bảng điều khiển FPT
 *
 * Màn Tổng quan P-80 trả lời "đội làm được bao nhiêu". Màn này trả lời "máy có
 * đang chạy đúng không". Hai câu hỏi đó không trộn vào một màn.
 */

/** Đơn chờ giấy chứng nhận quá ngần này phút thì đẩy thông báo lần đầu. */
export const OPS_CERT_WARN_MINUTES = 10;
/** Quá ngần này phút thì nhắc lại đúng một lần nữa, rồi thôi. */
export const OPS_CERT_REMIND_MINUTES = 15;
/** Tài nguyên dùng quá ngần này phần trăm thì đẩy thông báo. */
export const OPS_RESOURCE_PERCENT = 80;

/** Số ngày của khối thống kê kiểm ảnh. Người xem bấm đổi, máy chủ nhận số khác thì dùng mặc định. */
export const OPS_DAY_RANGES = [1, 7, 30] as const;
export const OPS_DEFAULT_DAYS = 1;

export const OpsBankCheck = z.object({
  bankId: z.string(),
  /** Bảng `banks` chỉ có mã, không có tên hiển thị — mọi màn khác cũng in mã này. */
  bankCode: z.string(),
  /** Lượt kiểm chưa chạy — không kẹp theo khoảng ngày, hàng đợi là chuyện hiện tại. */
  pending: z.number(),
  /** Ba con số dưới đây đếm LƯỢT KIỂM đã chạy xong trong khoảng ngày đang chọn. */
  passed: z.number(),
  failed: z.number(),
  /** Worker không chạy nổi lượt kiểm: ảnh hỏng, OCR ngã, hết giờ chờ. */
  error: z.number(),
});
export type OpsBankCheck = z.infer<typeof OpsBankCheck>;

export const OpsPhotoCheck = z.object({
  pending: z.number(),
  /** ISO datetime của lượt đợi lâu nhất. Rỗng = hàng đợi trống. */
  oldestPendingAt: z.string(),
  banks: z.array(OpsBankCheck),
});
export type OpsPhotoCheck = z.infer<typeof OpsPhotoCheck>;

/**
 * Một dòng của bảng đơn ở P-99. Bảng liệt kê MỌI đơn, mọi trạng thái; bộ lọc
 * mặc định là đơn điện đang đợi GCN (chốt 2026-09-23).
 */
export const OpsOrderRow = z.object({
  id: z.string(),
  orderCode: z.string(),
  customerName: z.string(),
  packageName: z.string(),
  createdByName: z.string(),
  status: InsuranceOrderStatus,
  /**
   * Cấp lại được hay không, tính sẵn ở máy chủ.
   *
   * Hai luật giữ nguyên (chốt 2026-09-22): huỷ đơn ngoài ngày lập cần
   * `insurance:set-status`, và ngày bắt đầu của đơn mới không được ở quá khứ.
   * Cộng thêm: chỉ đơn đang đợi GCN mới cấp lại được.
   */
  canRecreate: z.boolean(),
  blockedReason: z.string(),
});
export type OpsOrderRow = z.infer<typeof OpsOrderRow>;

export const OpsOrderPage = pageOf(OpsOrderRow);

export const OPS_ORDER_SORTS = ['orderCode'] as const;
export type OpsOrderSort = (typeof OPS_ORDER_SORTS)[number];

/** Bộ lọc mặc định khi mở màn. Chuỗi rỗng = không lọc trục đó. */
export const OPS_ORDER_DEFAULT_PRODUCT: InsuranceProduct = 'electric-accident';
export const OPS_ORDER_DEFAULT_STATUS: InsuranceOrderStatus = 'awaiting-certificate';

export type OpsOrderFilter = {
  product: InsuranceProduct | '';
  status: InsuranceOrderStatus | '';
};

export const OpsInsurance = z.object({
  awaiting: z.number(),
  /** Đơn đợi GCN lâu nhất. `null` = không đơn nào đang đợi. */
  oldest: z
    .object({ orderCode: z.string(), customerName: z.string(), waitingMinutes: z.number() })
    .nullable(),
});
export type OpsInsurance = z.infer<typeof OpsInsurance>;

export const OpsHost = z.object({
  /** ISO datetime của lượt đo. Rỗng = script `ops:watch` chưa chạy lần nào. */
  at: z.string(),
  cpuPercent: z.number(),
  ramUsed: z.number(),
  ramTotal: z.number(),
  diskUsed: z.number(),
  diskTotal: z.number(),
  /**
   * S3 đo THƯA hơn ba cái trên: một lượt đo phải duyệt hết object trong bucket.
   * `s3At` vì thế là mốc riêng, không phải `at`.
   */
  s3Bytes: z.number(),
  s3Objects: z.number(),
  s3At: z.string(),
  /** Hạn mức bucket (byte) đọc từ `S3_QUOTA_GB`. 0 = chưa đặt, màn không vẽ thanh phần trăm. */
  s3Quota: z.number(),
});
export type OpsHost = z.infer<typeof OpsHost>;

export const OpsSummary = z.object({
  photoCheck: OpsPhotoCheck,
  insurance: OpsInsurance,
  host: OpsHost.nullable(),
  days: z.number(),
});
export type OpsSummary = z.infer<typeof OpsSummary>;

/**
 * Trạng thái đầu của lô đơn cấp lại — NGƯỜI BẤM chọn, cùng luật với lượt cấp
 * lại một đơn ở P-14 (chốt 2026-09-22).
 */
export const OpsRecreateStatus = z.enum(['queued', 'manual-queued']);
export type OpsRecreateStatus = z.infer<typeof OpsRecreateStatus>;

export const OPS_RECREATE_STATUS_LABEL: Record<OpsRecreateStatus, string> = {
  queued: 'Chờ tạo',
  'manual-queued': 'Chờ làm tay',
};

/** Trần số đơn một lượt bấm. Mỗi đơn là một lượt huỷ cộng một lượt tạo, chạy tuần tự. */
export const OPS_RECREATE_MAX = 50;

export const OpsRecreateBody = z.object({
  ids: z.array(z.string()).min(1, 'Chưa chọn đơn nào').max(OPS_RECREATE_MAX),
  status: OpsRecreateStatus,
  reason: z.string().trim().min(2, 'Chưa nhập lý do huỷ'),
});
export type OpsRecreateBody = z.infer<typeof OpsRecreateBody>;

export const OpsRecreateResult = z.object({
  id: z.string(),
  orderCode: z.string(),
  ok: z.boolean(),
  /** Mã đơn mới khi thành công, câu lý do khi không. */
  message: z.string(),
});
export type OpsRecreateResult = z.infer<typeof OpsRecreateResult>;

export const OpsRecreateOutcome = z.object({
  done: z.number(),
  failed: z.number(),
  results: z.array(OpsRecreateResult),
});
export type OpsRecreateOutcome = z.infer<typeof OpsRecreateOutcome>;

/** Trần số đơn một lượt chạy lại policy. Worker API xử lý từng đơn một, lô lớn thì đợi lâu. */
export const OPS_REFRESH_MAX = 50;

export const OpsRefreshBody = z.object({
  ids: z.array(z.string()).min(1, 'Chưa chọn đơn nào').max(OPS_REFRESH_MAX),
});
export type OpsRefreshBody = z.infer<typeof OpsRefreshBody>;

export async function fetchOpsOrders(
  query: PageQuery<OpsOrderSort>,
  filter: OpsOrderFilter,
): Promise<Page<OpsOrderRow>> {
  const res = await fetch(`/api/ops/insurance?${pageParams(query, filter)}`);
  if (!res.ok) throw new Error('Không đọc được danh sách đơn');
  return OpsOrderPage.parse(await res.json());
}

export async function refreshPolicies(body: OpsRefreshBody): Promise<OpsRecreateOutcome> {
  const res = await fetch('/api/ops/insurance/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không chạy lại được policy');
  return OpsRecreateOutcome.parse(data);
}

export async function fetchOpsSummary(days: number): Promise<OpsSummary> {
  const res = await fetch(`/api/ops?days=${days}`);
  if (!res.ok) throw new Error('Không đọc được số liệu vận hành');
  return OpsSummary.parse(await res.json());
}

export async function recreateStuckOrders(body: OpsRecreateBody): Promise<OpsRecreateOutcome> {
  const res = await fetch('/api/ops/insurance/recreate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? 'Không cấp lại được lô đơn này');
  return OpsRecreateOutcome.parse(data);
}
