import { z } from 'zod';
import { InsuranceProduct } from '@/lib/types';
import {
  InsuranceOrderSource,
  InsuranceOrderStatus,
  type InsuranceManualStep,
  type InsuranceOrderEditForm,
  type InsuranceOrderForm,
} from './insuranceOrders';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-13 · Danh sách đơn bảo hiểm · P-14 · Chi tiết
 * (mgst-feature-list.md P-13/P-14 · mgst-platform-spec.md §3.4, §3.6).
 *
 * Đơn bảo hiểm CÓ áp trục phạm vi (spec §2.1b) — nhưng phạm vi KHÔNG đi qua
 * đường truyền: máy chủ tự lấy mức rộng nhất người gọi được cấp. Nhận `scope`
 * hay `actorId` từ client là mở hai ô để nặn tay mà không thêm tính năng nào.
 */

export const InsuranceListRow = z.object({
  id: z.string(),
  /** DH-YYMM-NNN (spec P-12) — sinh lúc tạo, không đổi theo trạng thái sau đó. */
  orderCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  product: InsuranceProduct,
  packageName: z.string(),
  /** Mức phí của ĐƠN này (đ) — prefill từ gói, sửa được từng đơn (03/08). */
  fee: z.number(),
  status: InsuranceOrderStatus,
  source: InsuranceOrderSource,
  /**
   * NGÀY TẠO ĐƠN — ngày nhân viên thật sự lập đơn cho khách, và là ngày dùng để
   * tính kỳ (KPI, dashboard, bộ lọc P-13).
   *
   * Đọc từ `created_at`, và cột đó SỬA ĐƯỢC (chốt 07/08): hệ thống sập hay mất
   * mạng ngoài hiện trường thì hôm sau nhập bù vẫn ghi được đúng ngày đã làm.
   * Vết kiểm toán không nằm ở đây mà ở bảng `audit_log` (P-93), nên cho sửa cột
   * này không xoá dấu vết gì.
   */
  orderDate: z.string(),
  /** Ngày hợp đồng bắt đầu có hiệu lực — KHÁC ngày tạo đơn, người nhập tự chọn. */
  startDate: z.string(),
  endDate: z.string(),
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  /**
   * Phòng của người tạo LÚC TẠO — giao diện cần nó để biết dòng này có nằm
   * trong phạm vi `managed` của người xem không, tức có hiện nút Sửa/Huỷ hay
   * không. Xem `recordInScope`.
   */
  createdByDepartmentId: z.string().nullable(),
  /**
   * Người XỬ LÝ TAY (chốt 03/08) — trường khác hẳn `createdBy`. Có giá trị từ
   * lúc bấm "Nhận đơn xử lý"; null với đơn chưa ai cầm.
   */
  handledById: z.string().nullable(),
  handledByName: z.string().nullable(),
  /** Ảnh chụp giấy chứng nhận — thay cho PDF, có thể null dù đơn đã hoàn thành. */
  certificatePhotoUrl: z.string().nullable(),
  /**
   * Số lần bot đã hỏi PVI mà chưa lấy được giấy chứng nhận.
   *
   * Màn hình đọc nó cùng `status` qua `certificateNeedsHelp` để biết đơn nào
   * đang đợi bình thường và đơn nào bot đã thôi thử.
   */
  certificateAttempts: z.number().default(0),
});
export type InsuranceListRow = z.infer<typeof InsuranceListRow>;

/**
 * Trọn bản ghi một đơn.
 *
 * Bốn trường người thụ hưởng KHÔNG nằm ở dòng danh sách: một trong số đó là
 * CCCD, và bảng P-13 không có lý do gì để chở CCCD của mười lăm người qua
 * đường truyền mỗi lần lật trang.
 */
export const InsuranceOrder = InsuranceListRow.extend({
  beneficiaryName: z.string(),
  beneficiaryDob: z.string(),
  beneficiaryIdNumber: z.string(),
  /**
   * Máy chủ ĐÃ GIẤU số này vì người xem không có phần trong đơn.
   *
   * Khác `beneficiaryIdNumber === ''` (đơn vốn không có CCCD): cờ này nói "có
   * số, nhưng bạn chưa được xem" — màn hình phải nói ra lý do, chứ để trống thì
   * người dùng tưởng dữ liệu thiếu rồi đi nhập lại.
   */
  beneficiaryIdNumberHidden: z.boolean().default(false),
  beneficiaryPhone: z.string(),
  /** BH tai nạn điện tính theo HỘ nên địa chỉ là thông tin lõi (thêm 03/08). */
  beneficiaryAddress: z.string(),
  /** Hai trường dưới chỉ có giá trị với đơn tai nạn điện — 0 với đơn xe máy. */
  householdSize: z.number(),
  sumInsured: z.number(),
  /** Bốn trường xe chỉ có giá trị với đơn BH xe máy — rỗng với đơn khác. */
  licensePlate: z.string(),
  vehicleType: z.string(),
  chassisNumber: z.string(),
  engineNumber: z.string(),
  /** Đơn vị của người tạo LÚC TẠO — chụp một lần, không tra động (spec §1.1.5). */
  createdByDepartmentId: z.string().nullable(),
  /**
   * Link file PDF giấy chứng nhận do PVI gửi về ở callback mục 13.
   *
   * URL tuyệt đối sang máy chủ PVI — khác `certificatePhotoUrl` là ảnh trong kho
   * của mình. Chuỗi rỗng = chưa nhận callback.
   *
   * CỐ Ý không nằm ở dòng danh sách: P-13 không cần link, và mỗi dòng chở thêm
   * một URL dài là tốn đường truyền cho mười lăm dòng mỗi lần lật trang.
   */
  pviCertificateUrl: z.string().default(""),
  /** Số ấn chỉ điện tử từ cùng callback. Chuỗi rỗng = chưa nhận. */
  pviSerialNumber: z.string().default(""),
});
export type InsuranceOrder = z.infer<typeof InsuranceOrder>;

/** Một bước chuyển trạng thái — dựng dòng thời gian ở P-14. */
export const InsuranceStatusStep = z.object({
  id: z.string(),
  /** null = dòng khởi tạo đơn. */
  fromStatus: InsuranceOrderStatus.nullable(),
  toStatus: InsuranceOrderStatus,
  /** null = hệ thống tự chuyển, không phải người bấm. */
  changedByName: z.string().nullable(),
  changedAt: z.string(),
});
export type InsuranceStatusStep = z.infer<typeof InsuranceStatusStep>;

/** P-14 · Toàn bộ dữ liệu đã nhập + dòng thời gian trạng thái kèm mốc giờ. */
export const InsuranceDetail = InsuranceOrder.extend({
  history: z.array(InsuranceStatusStep),
});
export type InsuranceDetail = z.infer<typeof InsuranceDetail>;

/**
 * Khoá sắp xếp — DANH SÁCH TRẮNG, vì nó đi thẳng vào `ORDER BY` của máy chủ.
 *
 * Chỉ cột nằm trong chính bảng `insurance_orders`. Sắp theo tên khách hay tên
 * người tạo thì phải nối bảng TRƯỚC khi cắt trang, tức gộp cả kho để lấy 15
 * dòng (AGENTS.md §5.2).
 */
export const INSURANCE_SORT = ['date'] as const;
export type InsuranceSort = (typeof INSURANCE_SORT)[number];

export type InsuranceQuery = PageQuery<InsuranceSort> & {
  /** Tìm theo TÊN KHÁCH HÀNG (spec P-13) — không dấu, không phụ thuộc thứ tự từ. */
  search: string;
  /** Rỗng = mọi trạng thái. Hàng đợi đơn lỗi P-15 chính là màn này lọc `Chờ làm tay`. */
  status: InsuranceOrderStatus | '';
  /** Rỗng = tất cả loại. Có giá trị thì phải là enum, không nhận nhãn tiếng Việt. */
  product: InsuranceProduct | '';
  /** Khoảng NGÀY TẠO ĐƠN, YYYY-MM-DD. Rỗng = không giới hạn. */
  from: string;
  to: string;
  staffId: string;
  /**
   * `staffId` soi vai nào của đơn. Một đơn có HAI người liên quan, nên "lọc
   * theo nhân viên" là câu hỏi mơ hồ nếu không nói rõ vai.
   */
  staffRole: 'creator' | 'handler' | 'any';
};

const InsurancePage = pageOf(InsuranceListRow);

const listParams = (query: Omit<InsuranceQuery, keyof PageQuery>) => ({
  search: query.search,
  status: query.status,
  product: query.product,
  from: query.from,
  to: query.to,
  staffId: query.staffId,
  staffRole: query.staffRole,
});

/** MỘT trang đơn bảo hiểm, đã lọc/tìm/sắp sẵn ở máy chủ (AGENTS.md §5.1). */
export async function fetchInsuranceOrders(query: InsuranceQuery): Promise<Page<InsuranceListRow>> {
  const res = await fetch(`/api/insurance-list?${pageParams(query, listParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách đơn bảo hiểm');
  return InsurancePage.parse(await res.json());
}

/**
 * TRỌN danh sách khớp bộ lọc, CHỈ cho việc xuất Excel — đường riêng chứ không
 * mở tham số "lấy hết" trên route đã phân trang (AGENTS.md §5.1, điều 4).
 *
 * `total` có thể lớn hơn `rows.length` khi chạm trần — nơi gọi BẮT BUỘC so hai
 * số rồi dừng, vì file thiếu dòng trông y hệt file đủ.
 */
export async function fetchInsuranceOrdersForExport(
  query: Omit<InsuranceQuery, keyof PageQuery>,
): Promise<Page<InsuranceListRow>> {
  const res = await fetch(`/api/insurance-list/export?${new URLSearchParams(listParams(query))}`);
  if (!res.ok) throw new Error('Không tải được danh sách đơn bảo hiểm');
  return InsurancePage.parse(await res.json());
}

export async function fetchInsuranceDetail(id: string): Promise<InsuranceDetail> {
  const res = await fetch(`/api/insurance-list/${id}`);
  if (res.status === 404) throw new Error('Không tìm thấy đơn bảo hiểm này');
  if (!res.ok) throw new Error('Không tải được chi tiết đơn bảo hiểm');
  return InsuranceDetail.parse(await res.json());
}

/**
 * Máy chủ đã nói rõ vì sao ("Đơn đã hoàn thành thì không sửa được nữa") — nuốt
 * đi rồi ném câu chung chung là bắt người dùng tự đoán mình sai chỗ nào.
 */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message?.trim() || fallback);
}

/** Một gói khai mấy leg thì tạo bấy nhiêu đơn — máy chủ trả về đủ cả chùm. */
export async function createInsuranceOrders(form: InsuranceOrderForm): Promise<InsuranceListRow[]> {
  const res = await fetch('/api/insurance-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không tạo được đơn bảo hiểm này');
  return z.array(InsuranceListRow).parse(await res.json());
}

export async function updateInsuranceOrder(
  id: string,
  form: InsuranceOrderEditForm,
): Promise<InsuranceListRow> {
  const res = await fetch(`/api/insurance-list/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được thay đổi này');
  return InsuranceListRow.parse(await res.json());
}

/**
 * Huỷ hẳn một đơn CHƯA hoàn thành — không có trạng thái "đã huỷ", cùng lối với
 * tài khoản ngân hàng bỏ dở (spec §4.5). Đơn đã `Hoàn thành` là hợp đồng đã
 * phát hành bên PVI nên máy chủ từ chối; đơn quà tặng cũng vậy, nó là vết của
 * một đợt tặng quà.
 */
export async function deleteInsuranceOrder(id: string): Promise<void> {
  const res = await fetch(`/api/insurance-list/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'Không huỷ được đơn này');
}

/**
 * Hai nút thao tác tay ở P-14: nhận đơn từ hàng chờ (`Chờ làm tay` → `Đang làm
 * tay`, gắn luôn người bấm vào trường người xử lý), rồi đánh dấu hoàn thành.
 * Máy chủ tự kiểm bước chuyển hợp lệ, không nhận trạng thái tuỳ ý từ client.
 */
export async function setInsuranceOrderStatus(
  id: string,
  status: InsuranceManualStep,
): Promise<InsuranceDetail> {
  const res = await fetch(`/api/insurance-orders/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw await failure(res, 'Không đổi được trạng thái đơn này');
  return InsuranceDetail.parse(await res.json());
}

/** Đính/thay ảnh chứng nhận — dùng được ở MỌI trạng thái đơn (spec §3.4). */
export async function setInsuranceOrderPhoto(
  id: string,
  photoUrl: string,
): Promise<InsuranceDetail> {
  const res = await fetch(`/api/insurance-orders/${id}/photo`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoUrl }),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được ảnh chứng nhận này');
  return InsuranceDetail.parse(await res.json());
}
