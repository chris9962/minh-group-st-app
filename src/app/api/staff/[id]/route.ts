import { StaffForm } from "@/lib/api/staff";
import { logAudit } from "@/server/audit";
import { getActor, unauthorized } from "@/server/auth";
import { findStaff, saveError, updateStaff } from "@/server/staff";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const staff = await findStaff(id);
  if (!staff) return new Response(null, { status: 404 });

  // Hồ sơ nhân viên kèm cả bảng quyền — lượt xem này đáng ghi vết.
  await logAudit(actor, {
    module: "staff",
    action: "view-detail",
    targetLabel: `Nhân viên ${staff.fullName}`,
    targetTable: "users",
    targetId: staff.id,
  });
  return Response.json(staff);
}

export async function PATCH(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  const parsed = StaffForm.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ message: "Dữ liệu không hợp lệ" }, { status: 400 });

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
