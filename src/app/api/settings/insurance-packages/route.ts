import { InsurancePackageForm } from "@/lib/api/settings";
import { logAudit } from "@/server/audit";
import { actorWith, signedIn, badRequest, jsonBody } from "@/server/auth";
import { createInsurancePackage, listInsurancePackages } from "@/server/catalog";

/** P-82 · Danh mục gói bảo hiểm. */
export async function GET(request: Request) {
  // Danh mục dùng chung: mọi form nghiệp vụ đều phải đọc được để đổ vào ô chọn,
  // nên chỉ chặn ở mức đã đăng nhập. Quyền SỬA bên dưới vẫn gác như cũ.
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await listInsurancePackages());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "insurance", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = InsurancePackageForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createInsurancePackage(parsed.data);
  if (!result.ok) return badRequest("Tên gói bảo hiểm này đã có");
  const item = result.item;

  await logAudit(guard.actor, {
    module: "insurance",
    action: "create",
    targetLabel: `Thêm gói bảo hiểm ${item.name}`,
    targetTable: "insurance_packages",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}
