import { SERVICE_WEIGHTS_FROM, ServiceTypeForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, signedIn, badRequest, jsonBody } from "@/server/auth";
import { createServiceType, listUsableServiceTypes } from "@/server/catalog";
import { closedMonthMessage } from "@/server/closedMonths";

/** Tháng của trọng số. Trước tháng có trọng số đầu tiên thì không nhận. */
const monthFrom = (request: Request): string | null => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= SERVICE_WEIGHTS_FROM ? month : null;
};

/** P-84 · Danh mục loại dịch vụ + hệ số điểm. */
export async function GET(request: Request) {
  // Danh mục dùng chung: mọi form nghiệp vụ đều phải đọc được để đổ vào ô chọn,
  // nên chỉ chặn ở mức đã đăng nhập. Quyền SỬA bên dưới vẫn gác như cũ.
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await listUsableServiceTypes());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = ServiceTypeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const month = monthFrom(request);
  if (!month) return badRequest();

  const result = await createServiceType(parsed.data, month, guard.actor.id);
  if (!result.ok)
    return badRequest(
      result.reason === "month-closed" ? closedMonthMessage(result.month) : "Tên loại dịch vụ này đã có",
    );
  const item = result.item;

  await logAudit(guard.actor, {
    module: "services",
    action: "create",
    targetLabel: `Thêm loại dịch vụ ${item.name}`,
    targetTable: "service_types",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}
