"use client";

import { useQuery } from "@tanstack/react-query";
import { Select } from "@/components/ui/Select";
import { fetchDepartments } from "@/lib/api/departments";
import { writableDepartmentIds } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/types";
import { useSession } from "@/store/session";

type Props = {
  module: ModuleKey;
  value: string;
  onChange: (departmentId: string) => void;
  error?: string;
};

/**
 * Ô chọn phòng ghi nhận bản ghi mới — CHỈ hiện với người không thuộc phòng nào.
 *
 * Giám đốc, Cố vấn và các Phó GĐ có `department_id` NULL (spec §2.2). Bản ghi
 * họ tạo ra vì vậy cũng mang phòng NULL, mà mọi màn danh sách lọc theo
 * `inArray(created_by_department_id, …)`: NULL không khớp phòng nào nên bản ghi
 * biến khỏi màn ngay sau khi tạo. Cho họ chọn phòng là cách sửa đúng chỗ — số
 * liệu theo phòng cũng đủ theo.
 *
 * Trả `null` cho người có phòng: với họ không có gì để chọn, và bày ra một ô
 * chỉ có đúng một lựa chọn là thêm một bước bấm không đổi được gì.
 */
export function DepartmentPicker({ module, value, onChange, error }: Props) {
  const user = useSession((s) => s.user);
  const allowed = writableDepartmentIds(user, module);

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    enabled: !!user && user.departmentId === null,
  });

  if (!user || user.departmentId !== null) return null;

  const options = departments.filter((d) => allowed === null || allowed.includes(d.id));

  return (
    <Select
      block
      required
      label="Ghi nhận vào phòng"
      value={value}
      onChange={onChange}
      error={error}
      options={[
        { value: "", label: "— Chọn phòng —" },
        ...options.map((d) => ({ value: d.id, label: d.name })),
      ]}
    />
  );
}
