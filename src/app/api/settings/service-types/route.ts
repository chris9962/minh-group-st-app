import { ServiceTypeForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, signedIn, badRequest, jsonBody } from "@/server/auth";
import { createServiceType, listServiceTypes } from "@/server/catalog";

/** P-84 · Danh mục loại dịch vụ + hệ số điểm. */
export async function GET(request: Request) {
  // Danh mục dùng chung: mọi form nghiệp vụ đều phải đọc được để đổ vào ô chọn,
  // nên chỉ chặn ở mức đã đăng nhập. Quyền SỬA bên dưới vẫn gác như cũ.
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await listServiceTypes());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = ServiceTypeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createServiceType(parsed.data);
  if (!result.ok) return badRequest("Tên loại dịch vụ này đã có");
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
