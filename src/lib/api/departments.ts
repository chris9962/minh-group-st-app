import { z } from 'zod';
import { Department } from '@/lib/types';

/** Danh sách phòng ban để đổ vào bộ lọc. Lấy từ máy chủ, không viết cứng ở giao diện. */
export const DepartmentList = z.array(Department);

export async function fetchDepartments(): Promise<Department[]> {
  const res = await fetch('/api/departments');
  if (!res.ok) throw new Error('Không tải được danh sách phòng ban');
  return DepartmentList.parse(await res.json());
}
