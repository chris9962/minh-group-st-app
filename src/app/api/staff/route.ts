import type { StaffForm, StaffQuery } from "@/lib/api/staff";
import type { RoleKey } from "@/lib/types";
import { logAudit } from "@/server/audit";
import { getActor, unauthorized } from "@/server/auth";
import { createStaff, saveError, staffFor } from "@/server/staff";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const params = new URL(request.url).searchParams;
  const query: StaffQuery = {
    scope: params.get("scope") ?? "",
    departmentId: params.get("departmentId") ?? "",
    search: params.get("search") ?? "",
    status: (params.get("status") ?? "active") as StaffQuery["status"],
    roles: (params.get("roles") ?? "").split(",").filter(Boolean) as RoleKey[],
  };

  return Response.json(await staffFor(actor, query));
}

export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  // `actorId` client gửi kèm (di sản thời mock) bị bỏ qua — actor lấy từ phiên.
  const { actorId: _ignored, ...form } = (await request.json()) as StaffForm & {
    actorId?: string;
  };
  void _ignored;

  const result = await createStaff(actor, form);
  if (!result.ok) return Response.json(saveError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "staff",
    action: "create",
    targetLabel: `Nhân viên ${result.staff.fullName}`,
    targetTable: "users",
    targetId: result.staff.id,
  });
  return Response.json(result.staff, { status: 201 });
}
