import { recordVisibility } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { actorWith, uuidParam } from "@/server/auth";
import { listCustomersForExport } from "@/server/customers";

/**
 * Trọn danh sách khách khớp bộ lọc, cho màn Xuất dữ liệu.
 *
 * Route RIÊNG chứ không phải tham số "lấy hết" của `/api/customers`: đường đó
 * mở ra một lần là mọi màn sau đều lách qua nó (AGENTS.md §5.1, điều 4). Đổi
 * lại, chỗ này gác bằng `customer:export` và có trần dòng ở tầng máy chủ.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "customer", "export");
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;

  // Trả `{ rows, total }` chứ không phải mảng trần: nơi gọi phải so được hai số
  // để biết file có bị cắt ở trần không.
  /**
   * Phạm vi lấy theo `export`, KHÔNG theo `view-detail`.
   *
   * Hai quyền cấp riêng nhau: ai được `view-detail` toàn công ty nhưng `export`
   * một phòng thì vẫn xuất được cả kho nếu kẹp nhầm vế (AGENTS.md §6).
   *
   * Không siết ở đây thì nút Xuất đi vòng qua phạm vi của màn P-40: cấp quản lý
   * thấy khách phòng mình trên bảng nhưng kéo được trọn kho ra file.
   */
  const view = recordVisibility(guard.actor, "customer", "export");

  const result = await listCustomersForExport({
    search: params.get("search") ?? "",
    channelId: uuidParam(params.get("channelId")),
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    // Mảng rỗng ở ca `none` chứ không phải `undefined` — cùng lý do đã ghi ở
    // `departmentScope` của route P-40: bỏ lọc là kéo trọn kho cho đúng người
    // đáng hẹp nhất.
    departmentIds:
      view.kind === "departments" ? view.departmentIds : view.kind === "none" ? [] : undefined,
    createdBy: view.kind === "creator" ? view.userId : undefined,
  });

  /**
   * Lượt xuất nào cũng để lại vết (spec §2.8).
   *
   * Route này cần vết hơn bốn route xuất kia: một lượt xuất kéo theo số điện
   * thoại của toàn bộ khách trong phạm vi người đó, và với người có phạm vi
   * toàn công ty thì đó là trọn kho.
   */
  await logAudit(guard.actor, {
    module: "customer",
    action: "export",
    targetLabel: `Khách hàng · ${result.rows.length}/${result.total} dòng`,
  });

  return Response.json(result);
}
