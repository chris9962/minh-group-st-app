import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { personServicesForExport } from "@/server/people";

type Params = { params: Promise<{ id: string }> };

/**
 * TRỌN danh sách lượt dịch vụ kèm điểm của một người trong kỳ, cho nút Xuất Excel
 * của tab Điểm dịch vụ. Gác giống route xuất đơn đã xử lý bên cạnh.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  if (actor.id !== id && !can(actor, "staff", "export")) return forbidden();

  const query = new URL(request.url).searchParams;
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  if (!isRealIsoDate(from) || !isRealIsoDate(to) || from > to)
    return badRequest("Khoảng ngày không hợp lệ");

  const rows = await personServicesForExport(actor, id, { from, to });
  if (!rows) return notFound();

  await logAudit(actor, {
    module: "staff",
    action: "export",
    targetId: id,
    targetLabel: `Điểm dịch vụ - ${from} đến ${to} - ${rows.length} dòng`,
  });

  return Response.json(rows);
}
