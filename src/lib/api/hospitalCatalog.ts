import { z } from 'zod';

/**
 * P-60-style · Danh mục bệnh viện — danh sách phẳng, dùng cho kênh Bệnh viện
 * (mgst-platform-spec.md §2.5). Trước đây kênh `list` tự mang một mảng chuỗi
 * riêng (`listOptions`) — tách ra danh mục riêng vì bệnh viện là dữ liệu DÙNG
 * CHUNG thật sự (một danh sách cho mọi lần chọn kênh Bệnh viện), không phải
 * cấu hình riêng tư của một kênh.
 */

export const Hospital = z.object({
  id: z.string(),
  name: z.string(),
});
export type Hospital = z.infer<typeof Hospital>;

export const HospitalForm = z.object({
  name: z.string().trim().min(1, 'Chưa nhập tên bệnh viện'),
});
export type HospitalForm = z.infer<typeof HospitalForm>;

export async function fetchHospitals(): Promise<Hospital[]> {
  const res = await fetch('/api/settings/hospitals');
  if (!res.ok) throw new Error('Không tải được danh mục bệnh viện');
  return z.array(Hospital).parse(await res.json());
}

export async function createHospital(form: HospitalForm): Promise<Hospital> {
  const res = await fetch('/api/settings/hospitals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!res.ok) throw new Error('Không lưu được bệnh viện này');
  return Hospital.parse(await res.json());
}
