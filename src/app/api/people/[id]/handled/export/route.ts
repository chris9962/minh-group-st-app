import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { personHandledForExport } from "@/server/people";

type Params = { params: Promise<{ id: string }> };

/**
 * TRỌN danh sách đơn đã xử lý tay của một người trong kỳ, cho nút Xuất Excel.
 *
 * Đường riêng chứ không mở tham số "lấy hết" trên route đã phân trang
 * (AGENTS.md §5.1, điều 4). Gác bằng `staff:export` — cùng quyền với lượt xuất
 * bảng nhân sự, vì đây cũng là số liệu thành tích của một người.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  // Tự xuất việc của mình đi qua mà không cần `staff:export` — cùng lý do với
  // route danh sách bên cạnh.
  if (actor.id !== id && !can(actor, "staff", "export")) return forbidden();

  const query = new URL(request.url).searchParams;
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  if (!isRealIsoDate(from) || !isRealIsoDate(to) || from > to)
    return badRequest("Khoảng ngày không hợp lệ");

  const rows = await personHandledForExport(actor, id, { from, to });
  if (!rows) return notFound();

  // Lượt xuất nào cũng để lại vết (spec §10.4).
  await logAudit(actor, {
    module: "staff",
    action: "export",
    targetId: id,
    targetLabel: `Đơn đã xử lý · ${from} → ${to} · ${rows.length} dòng`,
  });

  return Response.json(rows);
}
