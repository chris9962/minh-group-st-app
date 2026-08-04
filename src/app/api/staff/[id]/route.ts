import { StaffForm } from "@/lib/api/staff";
import { inVisibleScope } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { saveError, staffTargetFor, updateStaff } from "@/server/staff";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const target = await staffTargetFor(actor, id, "view-detail");
  if (!target.ok) return target.response;

  // Hồ sơ nhân viên kèm cả bảng quyền — lượt xem này đáng ghi vết.
  await logAudit(actor, {
    module: "staff",
    action: "view-detail",
    targetLabel: `Nhân viên ${target.staff.fullName}`,
    targetTable: "users",
    targetId: target.staff.id,
  });
  return Response.json(target.staff);
}

export async function PATCH(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const target = await staffTargetFor(actor, id, "update");
  if (!target.ok) return target.response;

  const parsed = StaffForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  // `staffTargetFor` mới kiểm phòng HIỆN TẠI của người này. Không kiểm phòng
  // MỚI thì trưởng phòng đẩy được người sang phòng mình không quản — hoặc để
  // trống, và khi đó chỉ phạm vi toàn công ty còn với tới hồ sơ đó nữa. Cùng
  // dòng gác mà route POST đã có.
  if (!inVisibleScope(actor, "staff", "update", parsed.data.departmentId || null))
    return forbidden();

  const result = await updateStaff(actor, id, parsed.data);
  if (!result) return new Response(null, { status: 404 });
  if (!result.ok) return Response.json(saveError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "staff",
    action: "update",
    targetLabel: `Nhân viên ${result.staff.fullName}`,
    targetTable: "users",
    targetId: id,
  });
  return Response.json(result.staff);
}
