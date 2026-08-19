import { writableDepartmentIds } from "@/lib/permissions";
import type { ModuleKey, User } from "@/lib/types";

/**
 * Phòng ghi vào cột `created_by_department_id` của một bản ghi nghiệp vụ mới.
 *
 * Người THUỘC một phòng thì bản ghi mang phòng đó, và giá trị client gửi lên bị
 * bỏ qua — nhận nó là mở đường ghi bản ghi của mình sang phòng khác.
 *
 * Người KHÔNG thuộc phòng nào (Giám đốc, Cố vấn, Phó GĐ — spec §2.2) phải CHỌN
 * phòng. Bỏ trống thì cột này là NULL, mà mọi màn danh sách lọc theo
 * `inArray(created_by_department_id, …)`: NULL không khớp phòng nào nên bản ghi
 * biến khỏi màn ngay sau khi tạo, kể cả với chính người vừa tạo ra nó.
 */
export function departmentForNewRecord(
  actor: User,
  module: ModuleKey,
  requested: string,
): { ok: true; departmentId: string | null } | { ok: false; message: string } {
  if (actor.departmentId) return { ok: true, departmentId: actor.departmentId };

  if (!requested)
    return { ok: false, message: "Bạn không thuộc phòng nào — chọn phòng ghi nhận bản ghi này." };

  const allowed = writableDepartmentIds(actor, module);
  if (allowed !== null && !allowed.includes(requested))
    return { ok: false, message: "Bạn không phụ trách phòng này." };

  return { ok: true, departmentId: requested };
}
