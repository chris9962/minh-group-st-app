import { HamletUpdateForm } from "@/lib/api/wardCatalog";
import { canConfigureWards } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { actorPassing, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { deleteHamlet, updateHamlet } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorPassing(request, canConfigureWards);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = HamletUpdateForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateHamlet(id, parsed.data);
  if (!result.ok) return badRequest("Xã này đã có ấp trùng tên");
  const item = result.item;
  if (!item) return notFound();
  const province = item.province;
  if (!province) return notFound();

  // Đổi tên là việc đáng tra lại sau này (kênh ấp lưu chuỗi tên, xem
  // `updateHamlet`), nên nhật ký ghi rõ tên cũ khi tên đổi.
  const renamed = item.previousName !== parsed.data.name;
  await logAudit(guard.actor, {
    module: "system",
    action: "update",
    targetLabel: renamed
      ? `Đổi tên ấp ${item.previousName} thành ${parsed.data.name} (${province.name})`
      : `Cập nhật ấp ${parsed.data.name} (${province.name})`,
    targetTable: "hamlets",
    targetId: id,
  });
  return Response.json(province);
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await actorPassing(request, canConfigureWards);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const result = await deleteHamlet(id);
  if (!result) return notFound();
  const province = result.province;
  if (!province) return notFound();

  await logAudit(guard.actor, {
    module: "system",
    action: "delete",
    targetLabel: `Xoá ấp ${result.deletedName} (${province.name})`,
    targetTable: "hamlets",
    targetId: id,
  });
  return Response.json(province);
}
