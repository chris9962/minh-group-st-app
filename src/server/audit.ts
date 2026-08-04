import { db } from "./db/client";
import { auditLog } from "./db/schema";
import type { Action, ModuleKey, User } from "@/lib/types";

/**
 * Ghi nhật ký truy vết (P-93) — append-only, không có đường sửa/xoá.
 * Ghi cho mọi thao tác GHI và các lượt xem nhạy cảm (chi tiết nhân viên…).
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
