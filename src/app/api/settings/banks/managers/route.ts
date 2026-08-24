import { actorWith } from "@/server/auth";
import { listBankManagerCandidates } from "@/server/catalog";

/**
 * Nhân viên chọn được vào ô "Người quản" của một ngân hàng.
 *
 * Gác bằng `grant-permission`, KHÔNG bằng `manage-bank`: đây là danh sách phục
 * vụ việc GIAO quyền, mà người quản một ngân hàng không tự thêm ai vào ngân
 * hàng mình quản — cho phép là mở đường tự nới quyền.
 */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "grant-permission");
  if (!guard.ok) return guard.response;

  return Response.json(await listBankManagerCandidates());
}
