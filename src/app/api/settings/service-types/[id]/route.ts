import { SERVICE_WEIGHTS_FROM, ServiceTypeForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateServiceType } from "@/server/catalog";
import { closedMonthMessage } from "@/server/closedMonths";

/** Tháng của trọng số. Trước tháng có trọng số đầu tiên thì không nhận. */
const monthFrom = (request: Request): string | null => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= SERVICE_WEIGHTS_FROM ? month : null;
};

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = ServiceTypeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const month = monthFrom(request);
  if (!month) return badRequest();

  const result = await updateServiceType(id, parsed.data, month, guard.actor.id);
  if (!result.ok)
    return badRequest(
      result.reason === "month-closed" ? closedMonthMessage(result.month) : "Tên loại dịch vụ này đã có",
    );
  if (!result.item) return notFound();
  const { weightsChanged, ...item } = result.item;
  const [year, monthNumber] = month.split("-").map(Number);

  await logAudit(guard.actor, {
    module: "services",
    action: "update",
    targetLabel: weightsChanged
      ? `Sửa loại dịch vụ ${item.name}, trọng số tháng ${monthNumber}/${year}`
      : `Sửa loại dịch vụ ${item.name}`,
    targetTable: "service_types",
    targetId: id,
  });
  return Response.json(item);
}
