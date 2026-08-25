import { z } from 'zod';

/**
 * P-71 · Danh mục xã / ấp — CÂY BA CẤP: Tỉnh/Thành phố → Xã/Phường → Ấp/Khu vực
 * (mgst-platform-spec.md §2.4, mở rộng thêm tầng Tỉnh — cùng tên xã có thể
 * lặp lại ở nhiều tỉnh khác nhau, chỉ chọn xã không đủ phân biệt).
 *
 * Hai tầng dữ liệu TÁCH BIỆT:
 *
 * 1. THAM CHIẾU (`/api/reference/*`) — toàn bộ 34 tỉnh + 3.321 xã/phường
 *    THẬT của cả nước (nguồn: production.cas.so/address-kit). CHỈ DÙNG ĐỂ
 *    TÌM VÀ CHỌN khi quản lý "triển khai" thêm một tỉnh/xã — không ai sửa
 *    được, không phải danh mục đang vận hành.
 *
 * 2. ĐANG DÙNG (`/api/settings/provinces`) — danh mục THẬT của công ty,
 *    BẮT ĐẦU RỖNG. Quản lý bấm "Thêm tỉnh/thành phố" → tìm trong tham chiếu
 *    → thêm vào đây; bấm "Thêm xã/phường" trong tỉnh đó → tìm trong tham
 *    chiếu (đã lọc theo tỉnh) → thêm vào. Chỉ tỉnh/xã đã có Ở ĐÂY mới hiện
 *    ra khi mở tài khoản ngân hàng — không phải toàn bộ danh sách tham
 *    chiếu (nếu không KD sẽ phải cuộn qua 3.321 xã cả nước để tìm 5 xã công
 *    ty thật sự có khách).
 *
 * Ấp/khu vực KHÔNG có nguồn tham chiếu (không ai có sẵn danh sách ấp chính
 * xác) — luôn nhập tay, gắn thẳng vào xã đang dùng.
 */

/* ── Tham chiếu — chỉ đọc, dùng để tìm & chọn ─────────────────────────── */

export const ReferenceProvince = z.object({ id: z.string(), name: z.string() });
export type ReferenceProvince = z.infer<typeof ReferenceProvince>;

export const ReferenceWard = z.object({ id: z.string(), name: z.string(), provinceId: z.string() });
export type ReferenceWard = z.infer<typeof ReferenceWard>;

export async function fetchReferenceProvinces(): Promise<ReferenceProvince[]> {
  const res = await fetch('/api/reference/provinces');
  if (!res.ok) throw new Error('Không tải được danh sách tỉnh/thành phố');
  return z.array(ReferenceProvince).parse(await res.json());
}

/**
 * Xã/phường tham chiếu của một tỉnh ĐANG DÙNG.
 *
 * `provinceId` là uuid của dòng trong `provinces` (tỉnh công ty), KHÔNG phải mã
 * tham chiếu — nơi gọi chỉ có đối tượng `Province`, máy chủ tự tra sang mã.
 */
export async function fetchReferenceWards(provinceId: string): Promise<ReferenceWard[]> {
  const params = new URLSearchParams({ provinceId });
  const res = await fetch(`/api/reference/wards?${params}`);
  if (!res.ok) throw new Error('Không tải được danh sách xã/phường');
  return z.array(ReferenceWard).parse(await res.json());
}

/* ── Đang dùng — danh mục thật của công ty, bắt đầu rỗng ──────────────── */

export const Hamlet = z.object({ id: z.string(), name: z.string() });
export type Hamlet = z.infer<typeof Hamlet>;

export const Ward = z.object({
  id: z.string(),
  /**
   * Mã xã ở bảng THAM CHIẾU. Cần để lọc ra xã chưa thêm: `id` là uuid của dòng
   * công ty, không so được với id của danh sách tham chiếu.
   */
  refId: z.string(),
  name: z.string(),
  hamlets: z.array(Hamlet),
});
export type Ward = z.infer<typeof Ward>;

export const Province = z.object({
  id: z.string(),
  /** Mã tỉnh ở bảng THAM CHIẾU — cùng lý do với `Ward.refId`, xem ghi chú trên. */
  refId: z.string(),
  name: z.string(),
  wards: z.array(Ward),
});
export type Province = z.infer<typeof Province>;

export const AddProvinceForm = z.object({
  provinceId: z.string().min(1, 'Chưa chọn tỉnh/thành phố'),
});
export type AddProvinceForm = z.infer<typeof AddProvinceForm>;

/**
 * `provinceId` là uuid tỉnh của CÔNG TY, `wardId` là mã xã ở bảng THAM CHIẾU —
 * hai loại id khác nhau, đừng đổi chỗ. Ép dạng uuid ngay ở đây để id sai dạng
 * dừng lại ở tầng kiểm dữ liệu, chứ không đi tới Postgres rồi thành lỗi 500.
 */
export const AddWardForm = z.object({
  provinceId: z.guid('Chưa chọn tỉnh/thành phố'),
  wardId: z.string().min(1, 'Chưa chọn xã/phường'),
});
export type AddWardForm = z.infer<typeof AddWardForm>;

export const HamletForm = z.object({
  wardId: z.guid('Chưa chọn xã'),
  name: z.string().trim().min(1, 'Chưa nhập tên ấp'),
});
export type HamletForm = z.infer<typeof HamletForm>;

/**
 * Máy chủ đã nói rõ vì sao ("Xã này đã có ấp trùng tên") — nuốt đi rồi ném câu
 * chung chung là bắt người dùng tự đoán mình sai chỗ nào.
 */
async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return new Error(body?.message?.trim() || fallback);
}

export async function fetchProvinces(): Promise<Province[]> {
  const res = await fetch('/api/settings/provinces');
  if (!res.ok) throw new Error('Không tải được danh mục tỉnh/xã/ấp');
  return z.array(Province).parse(await res.json());
}

export async function addProvince(form: AddProvinceForm): Promise<Province> {
  const res = await fetch('/api/settings/provinces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không thêm được tỉnh/thành phố này');
  return Province.parse(await res.json());
}

export async function addWard(form: AddWardForm): Promise<Province> {
  const res = await fetch('/api/settings/provinces/wards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không thêm được xã/phường này');
  return Province.parse(await res.json());
}

/** Trả về tỉnh đã cập nhật (kèm ấp mới trong đúng xã) — nơi dùng chỉ cần nạp lại `['provinces']`. */
export async function createHamlet(form: HamletForm): Promise<Province> {
  const res = await fetch('/api/settings/hamlets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw await failure(res, 'Không lưu được ấp này');
  return Province.parse(await res.json());
}
