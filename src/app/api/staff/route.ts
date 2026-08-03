import { StaffForm, type StaffQuery } from "@/lib/api/staff";
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

  // Máy chủ tự kiểm dữ liệu vào — không tin client đã chạy zod. `actorId`
  // client gửi kèm (di sản cũ) rơi rụng luôn ở bước parse vì không có trong schema.
  const parsed = StaffForm.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ message: "Dữ liệu không hợp lệ" }, { status: 400 });

  const result = await createStaff(actor, parsed.data);
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
