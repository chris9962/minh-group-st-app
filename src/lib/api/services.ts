import { z } from 'zod';
import { pageOf, pageParams, type Page, type PageQuery } from './pagination';

/**
 * P-30 · Ghi dịch vụ · P-31 · Danh sách dịch vụ
 * (mgst-feature-list.md §4.6/§2.3 · mgst-platform-spec.md §6).
 *
 * Nghiệp vụ mới, mức chi tiết còn thấp: KHÔNG thu phí (đã chốt ở feature-list,
 * đóng câu hỏi mở trong spec), KHÔNG có màn chi tiết riêng (không có P-32).
 *
 * Bản ghi dịch vụ CÓ áp trục phạm vi (spec §2.1b) — nhưng phạm vi KHÔNG đi qua
 * đường truyền: máy chủ tự lấy mức rộng nhất người gọi được cấp. Thanh chọn
 * phạm vi đã bỏ khỏi giao diện (feature-list §2.3), nên gửi kèm một tham số
 * `scope` chỉ tạo thêm một ô để nặn tay mà không thêm được tính năng nào.
 */

export const ServiceRow = z.object({
  id: z.string(),
  customerName: z.string(),
  serviceTypeId: z.string(),
  serviceTypeName: z.string(),
  note: z.string(),
  date: z.string(),
  createdById: z.string(),
  createdByName: z.string(),
  /** Đơn vị của người tạo LÚC TẠO — chụp một lần, không tra động (spec §1.1.5). */
  createdByDepartmentId: z.string().nullable(),
  /**
   * Chỉ có giá trị khi người tạo thuộc Phòng Dự Án — ghi lúc tạo, không tra
   * động từ hồ sơ nhân viên (spec §6: đổi xã phụ trách không được làm đổi
   * dữ liệu tháng trước).
   */
  wardName: z.string().nullable(),
});
export type ServiceRow = z.infer<typeof ServiceRow>;

/**
 * Khoá sắp xếp — DANH SÁCH TRẮNG, vì nó đi thẳng vào `ORDER BY` của máy chủ.
 *
 * CHỈ có cột nằm trong chính bảng `services`. Sắp theo tên khách / tên loại
 * dịch vụ / tên nhân viên thì bắt buộc phải nối bảng TRƯỚC khi cắt trang, tức
 * gộp cả kho để lấy 15 dòng (AGENTS.md §5.2) — cái giá đó không đáng cho một
 * thứ mà spec P-31 không đòi.
 */
export const SERVICE_SORT = ['date'] as const;
export type ServiceSort = (typeof SERVICE_SORT)[number];

export type ServiceQuery = PageQuery<ServiceSort> & {
  /** Tìm theo TÊN KHÁCH HÀNG (spec §4.3 P-31) — không tìm theo ghi chú. */
  search: string;
  serviceTypeId: string;
  /** Khoảng NGÀY LÀM DỊCH VỤ, YYYY-MM-DD. Rỗng = không giới hạn. */
  from: string;
  to: string;
  /**
   * Lọc theo xã bằng `wardId`, không bằng tên: bản ghi chụp cả hai, mà xã đổi
   * tên thì lọc theo tên bỏ sót đúng những dòng cũ cần tìm.
   */
  wardId: string;
  staffId: string;
};

const ServicePage = pageOf(ServiceRow);

/**
 * Một TRANG dịch vụ. Lọc, tìm, sắp và cắt trang đều do máy chủ làm
 * (AGENTS.md §5.1) — nơi gọi chỉ hiện đúng những gì nhận được.
 */
export async function fetchServices(query: ServiceQuery): Promise<Page<ServiceRow>> {
  const res = await fetch(
    `/api/services?${pageParams(query, {
      search: query.search,
      serviceTypeId: query.serviceTypeId,
      from: query.from,
      to: query.to,
      wardId: query.wardId,
      staffId: query.staffId,
    })}`,
  );
  if (!res.ok) throw new Error('Không tải được danh sách dịch vụ');
  return ServicePage.parse(await res.json());
}

/**
 * TRỌN danh sách khớp bộ lọc, CHỈ cho việc xuất Excel.
 *
 * `total` có thể lớn hơn `rows.length` khi chạm trần 20.000 — nơi gọi BẮT BUỘC
 * so hai số rồi báo ra, đưa ra file thiếu dòng mà im lặng thì người nhận đọc nó
 * như báo cáo đầy đủ.
 */
export async function fetchServicesForExport(
  query: Omit<ServiceQuery, keyof PageQuery>,
): Promise<Page<ServiceRow>> {
  const params = new URLSearchParams({
    search: query.search,
    serviceTypeId: query.serviceTypeId,
    from: query.from,
    to: query.to,
    wardId: query.wardId,
    staffId: query.staffId,
  });
  const res = await fetch(`/api/services/export?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách dịch vụ');
  return ServicePage.parse(await res.json());
}

/**
 * NGÀY THỰC HIỆN người nhập tự chọn (chốt 07/08), mặc định hôm nay.
 *
 * Trước đây máy chủ tự ghi ngày nhập liệu và không ai sửa được. Ca hỏng thật:
 * làm dịch vụ cho khách ngày 31 nhưng mùng 2 mới ngồi nhập, lượt đó rơi sang
 * điểm KPI tháng sau và không có đường chữa — không phải lỗi nhập liệu, mà là
 * hệ thống không cho nhập đúng.
 *
 * Chặn ngày TƯƠNG LAI: đây là sổ ghi việc ĐÃ LÀM, một lượt dịch vụ của tuần sau
 * thì chưa xảy ra. Ngày lùi thì để tự do — máy chủ không đoán được nhân viên
 * nhập trễ bao lâu là hợp lý, và mọi lượt sửa đều nằm trong nhật ký truy vết.
 */
const serviceDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ');

export const ServiceForm = z.object({
  customerId: z.string().min(1, 'Chưa chọn khách'),
  serviceTypeId: z.string().min(1, 'Chưa chọn loại dịch vụ'),
  date: serviceDate,
  note: z.string().trim(),
});
export type ServiceForm = z.infer<typeof ServiceForm>;

/**
 * Sửa một lượt đã ghi — LOẠI, NGÀY và GHI CHÚ.
 *
 * Khách, người thực hiện, đơn vị và xã vẫn không sửa được: đổi khách là biến
 * bản ghi thành việc khác hẳn, đổi người thực hiện là chuyển công sang người
 * khác.
 *
 * ⚠️ Đổi ngày là ĐỔI THÁNG TÍNH ĐIỂM. Máy chủ phải tính lại KPI cho cả tháng cũ
 * lẫn tháng mới, không thì tháng cũ giữ nguyên điểm của một lượt đã dời đi.
 */
export const ServiceEditForm = ServiceForm.omit({ customerId: true });
export type ServiceEditForm = z.infer<typeof ServiceEditForm>;

/**
 * Máy chủ đã nói rõ vì sao ("Loại dịch vụ này đã ngừng dùng") — nuốt đi rồi ném
 * câu chung chung là bắt người dùng tự đoán mình sai chỗ nào.
 */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message?.trim() || fallback);
}

/** Người thực hiện, ngày, đơn vị và xã do máy chủ tự ghi — biểu mẫu không gửi. */
export async function createService(form: ServiceForm): Promise<ServiceRow> {
  const res = await fetch('/api/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được dịch vụ này');
  return ServiceRow.parse(await res.json());
}

/** Đổi loại dịch vụ là đổi điểm KPI — máy chủ tự tính lại cho người đã làm. */
export async function updateService(id: string, form: ServiceEditForm): Promise<ServiceRow> {
  const res = await fetch(`/api/services/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được thay đổi này');
  return ServiceRow.parse(await res.json());
}

/**
 * Xoá hẳn một bản ghi dịch vụ — không có trạng thái "đã huỷ", cùng lối với tài
 * khoản ngân hàng bỏ dở (spec §4.5). Điểm KPI của người thực hiện được tính lại
 * ngay sau đó.
 */
export async function deleteService(id: string): Promise<void> {
  const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'Không xoá được dịch vụ này');
}
