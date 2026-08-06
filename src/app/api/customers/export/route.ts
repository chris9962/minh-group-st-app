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
  return Response.json(
    await listCustomersForExport({
      search: params.get("search") ?? "",
      channelId: uuidParam(params.get("channelId")),
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
    }),
  );
}
