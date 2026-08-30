import { AUDIT_LOG_SORT } from "@/lib/api/auditLog";
import { can } from "@/lib/permissions";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listAuditLog } from "@/server/audit";
import { pageArgsFrom } from "@/server/pagination";

/**
 * P-93 · Nhật ký hoạt động — chiều ĐỌC.
 *
 * Gác bằng `system:manage-org`, KHÔNG phải `view-detail`: Kế toán tổng hợp cũng
 * có `view-detail` qua wildcard `*` nhưng không nên đọc được ai đã xem CCCD của
 * ai. Đây là bằng chứng bảo vệ, mở rộng người xem là làm hỏng chính nó.
 *
 * Không có nhánh POST/PATCH/DELETE và sẽ không bao giờ có — bảng chỉ ghi thêm
 * (mgst-db-design.md §10). Sửa được nhật ký thì nhật ký hết giá trị.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "manage-org")) return forbidden();

  const url = new URL(request.url);
  const params = url.searchParams;

  return Response.json(
    await listAuditLog(
      {
        // Chuỗi không phải uuid đi thẳng vào SQL là `22P02` → 500. Bỏ qua bộ
        // lọc hỏng chứ đừng làm vỡ cả màn.
        staffId: uuidParam(params.get("staffId")),
        // Hành động lạ rơi về "mọi hành động", xử lý trong `listAuditLog`.
        action: params.get("action") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
      },
      pageArgsFrom(url, AUDIT_LOG_SORT, "at"),
    ),
  );
}
