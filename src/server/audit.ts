import { db } from "./db/client";
import { auditLog } from "./db/schema";
import type { Action, ModuleKey, User } from "@/lib/types";

/**
 * Ghi nhật ký truy vết (P-93) — append-only, không có đường sửa/xoá.
 * Ghi cho mọi thao tác GHI và các lượt xem nhạy cảm (chi tiết nhân viên…).
 *
 * TODO(P-93, chờ nối FE–BE): chiều GHI dưới đây đã chạy thật và bảng `audit_log`
 * đang đầy dòng, nhưng CHƯA CÓ hàm đọc lẫn route `/api/audit-log`, nên màn P-93
 * mở ra là 404. Cần một hàm `listAuditLog` (lọc theo người/hành động/khoảng
 * ngày, phân trang ở máy chủ theo AGENTS.md §5.1) và route đọc gác bằng
 * `system:manage-org`. Gỡ mốc ở cả hai đầu — đầu kia ở `lib/api/auditLog.ts`.
 */
export async function logAudit(
  actor: User,
  entry: {
    module: ModuleKey;
    action: Action;
    targetLabel: string;
    targetTable?: string;
    targetId?: string;
  },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: actor.id,
      module: entry.module,
      action: entry.action,
      targetLabel: entry.targetLabel,
      targetTable: entry.targetTable ?? null,
      targetId: entry.targetId ?? null,
    });
  } catch (e) {
    /**
     * Hàm này chạy SAU khi bản ghi nghiệp vụ đã commit. Để lỗi ném ra thì
     * route trả 500 cho một thao tác THỰC RA ĐÃ THÀNH CÔNG, người dùng bấm lại
     * và tạo trùng. Mất một dòng nhật ký đỡ tệ hơn tạo trùng dữ liệu thật.
     *
     * ⚠️ Đây mới là nửa vá. Muốn nhật ký thật sự nguyên tử thì phải truyền
     * transaction của lệnh ghi vào đây, tức là dời `logAudit` từ route xuống
     * trong `writeStaff` / `createDepartment` — đổi rộng hơn, chưa làm.
     */
    console.error("[audit] không ghi được nhật ký truy vết:", entry, e);
  }
}
