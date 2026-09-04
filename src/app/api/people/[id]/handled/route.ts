import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { personHandledFor } from "@/server/people";

type Params = { params: Promise<{ id: string }> };

/**
 * P-52 · Đơn bảo hiểm người này đã XỬ LÝ TAY — cùng khuôn với bốn tab hoạt động.
 *
 * Gác bằng `staff:view-detail` như bốn route kia, KHÔNG bằng
 * `insurance:handle-fallback`: đây là màn xem thành tích của một người, không
 * phải màn thao tác lên đơn. Cấp trên đọc được hồ sơ nhân viên thì đọc được cả
 * phần việc xử lý tay của họ.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  /*
    Tự xem mình đi qua mà không cần `staff:view-detail`: chức vụ Nhân viên không
    có quyền đó, mà khối này nằm trên màn Tổng quan của chính họ. Đơn ở đây do
    chính họ xử lý nên không lộ thêm dữ liệu của ai.
  */
  if (actor.id !== id && !can(actor, "staff", "view-detail")) return forbidden();

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  // Chuỗi ngày bậy đi thẳng vào phép so của SQL là lỗi cast 500 — chặn thành 400.
  if (!isRealIsoDate(from) || !isRealIsoDate(to) || from > to)
    return badRequest("Khoảng ngày không hợp lệ");

  // Ngoài tầm nhìn trả 404, không phải 403 — 403 xác nhận id có thật.
  const page = await personHandledFor(actor, id, { from, to }, pageArgsFrom(url, ["date"], "date"));
  return page ? Response.json(page) : notFound();
}
