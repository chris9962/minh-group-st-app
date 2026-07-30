import { z } from 'zod';

/**
 * P-71 · Danh mục xã / ấp — cây hai cấp (mgst-platform-spec.md §2.4).
 * Dùng ở kênh Ấp, kênh Định danh, và (sau này) xã phụ trách của Phòng Dự án.
 */

export const Hamlet = z.object({ id: z.string(), name: z.string() });
export type Hamlet = z.infer<typeof Hamlet>;

export const Ward = z.object({ id: z.string(), name: z.string(), hamlets: z.array(Hamlet) });
export type Ward = z.infer<typeof Ward>;

export const WardForm = z.object({
  name: z.string().trim().min(1, 'Chưa nhập tên xã'),
});
export type WardForm = z.infer<typeof WardForm>;

export const HamletForm = z.object({
  wardId: z.string().min(1, 'Chưa chọn xã'),
  name: z.string().trim().min(1, 'Chưa nhập tên ấp'),
});
export type HamletForm = z.infer<typeof HamletForm>;

export async function fetchWards(): Promise<Ward[]> {
  const res = await fetch('/api/settings/wards');
  if (!res.ok) throw new Error('Không tải được danh mục xã/ấp');
  return z.array(Ward).parse(await res.json());
}

export async function createWard(form: WardForm): Promise<Ward> {
  const res = await fetch('/api/settings/wards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw new Error('Không lưu được xã này');
  return Ward.parse(await res.json());
}

/** Trả về xã đã cập nhật (kèm ấp mới) — gọi nơi dùng chỉ cần nạp lại `['wards']`. */
export async function createHamlet(form: HamletForm): Promise<Ward> {
  const res = await fetch('/api/settings/hamlets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw new Error('Không lưu được ấp này');
  return Ward.parse(await res.json());
}
