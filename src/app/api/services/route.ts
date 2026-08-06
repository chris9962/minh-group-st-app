import { SERVICE_SORT, ServiceForm } from "@/lib/api/services";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized, uuidParam } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { createService, listServices } from "@/server/services";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // Chốt này không thừa: `clampScope` một mình rơi về `own`, mà `own` là cả
  // phòng — thiếu nó thì ai đăng nhập cũng đọc được dịch vụ của đồng nghiệp.
  if (!can(actor, "services", "view-detail")) return forbidden();

  const url = new URL(request.url);
  const params = url.searchParams;

  return Response.json(
    await listServices(
      actor,
      {
        search: params.get("search") ?? "",
        // Chuỗi không phải uuid đi thẳng vào SQL là `22P02` → 500. Bỏ qua bộ
        // lọc hỏng chứ đừng làm vỡ cả màn.
        serviceTypeId: uuidParam(params.get("serviceTypeId")),
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        wardId: uuidParam(params.get("wardId")),
        staffId: uuidParam(params.get("staffId")),
      },
      pageArgsFrom(url, SERVICE_SORT, "date"),
    ),
  );
}

export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "services", "create")) return forbidden();

  // Máy chủ tự kiểm dữ liệu vào — không tin client đã chạy zod.
  const parsed = ServiceForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createService(actor, parsed.data);
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  await logAudit(actor, {
    module: "services",
    action: "create",
    targetLabel: `Dịch vụ ${result.service.serviceTypeName} cho ${result.service.customerName}`,
    targetTable: "services",
    targetId: result.service.id,
  });
  return Response.json(result.service, { status: 201 });
}
