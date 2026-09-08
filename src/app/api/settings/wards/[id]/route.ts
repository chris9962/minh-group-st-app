import { WardUpdateForm } from "@/lib/api/wardCatalog";
import { canConfigureWards } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { actorPassing, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateWard } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

/**
 * Chỉ sửa được TRƯỞNG XÃ. Tên xã chép từ tham chiếu lúc thêm và không có đường
 * sửa — đổi tên hành chính là việc của bảng tham chiếu, không phải của một
 * người dùng.
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorPassing(request, canConfigureWards);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = WardUpdateForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateWard(id, parsed.data);
  if (!result) return notFound();
  const province = result.province;
  if (!province) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: `Cập nhật trưởng xã ${result.wardName} (${province.name})`,
    targetTable: "wards",
    targetId: id,
  });
  return Response.json(province);
}
