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
  /**
   * Phòng của HỒ SƠ KHÁCH mà bản ghi này gắn vào (chốt 2026-09-03). Dùng khi
   * người tạo không thuộc phòng nào và không chọn gì: đơn bảo hiểm, tài khoản
   * ngân hàng và lượt dịch vụ đều mở cho một khách đã có hồ sơ, mà hồ sơ đó đã
   * thuộc về một phòng rồi — bắt cấp quản lý chọn lại là hỏi một câu mà dữ liệu
   * đã trả lời.
   *
   * Vẫn đi qua phép kiểm phạm vi bên dưới: phòng của khách nằm ngoài phần người
   * này phụ trách thì họ phải chọn tay, không mượn nó để ghi sang phòng khác.
   */
  customerDepartmentId: string | null = null,
): { ok: true; departmentId: string | null } | { ok: false; message: string } {
  if (actor.departmentId) return { ok: true, departmentId: actor.departmentId };

  const target = requested || customerDepartmentId || "";
  if (!target)
    return { ok: false, message: "Bạn không thuộc phòng nào — chọn phòng ghi nhận bản ghi này." };

  const allowed = writableDepartmentIds(actor, module);
  if (allowed !== null && !allowed.includes(target))
    return { ok: false, message: "Bạn không phụ trách phòng này." };

  return { ok: true, departmentId: target };
}
