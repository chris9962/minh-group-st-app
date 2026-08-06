import { HospitalForm } from "@/lib/api/hospitalCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, signedIn, badRequest, jsonBody } from "@/server/auth";
import { createHospital, listHospitals } from "@/server/catalog";

/** P-71 · Danh mục bệnh viện. */
export async function GET(request: Request) {
  // Danh mục dùng chung: mọi form nghiệp vụ đều phải đọc được để đổ vào ô chọn,
  // nên chỉ chặn ở mức đã đăng nhập. Quyền SỬA bên dưới vẫn gác như cũ.
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await listHospitals());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = HospitalForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createHospital(parsed.data);
  if (!result.ok) return badRequest("Tên bệnh viện này đã có");
  const item = result.item;

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm bệnh viện ${item.name}`,
    targetTable: "hospitals",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}
