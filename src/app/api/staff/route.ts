import { StaffForm, type StaffQuery } from "@/lib/api/staff";
import { can, inVisibleScope } from "@/lib/permissions";
import type { RoleKey } from "@/lib/types";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized } from "@/server/auth";
import { createStaff, saveError, staffFor } from "@/server/staff";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // Thiếu chốt này thì `clampScope` rơi về `own`, mà `own` lại là CẢ PHÒNG —
  // nhân viên kinh doanh không có quyền nào vẫn lấy được danh sách đồng nghiệp
  // kèm bảng quyền của từng người.
  //
  // Hỏi `view-detail` chứ không phải `view-summary`: `staffFor` kẹp phạm vi
  // theo `view-detail`, và payload trả về gồm số điện thoại + nguyên bảng
  // quyền — đúng thứ route một-bản-ghi bắt phải có `view-detail`. Chốt vào một
  // đằng, kẹp phạm vi một nẻo thì hoặc lọt dữ liệu, hoặc ra bảng trống không
  // báo gì.
  if (!can(actor, "staff", "view-detail")) return forbidden();

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
  if (!can(actor, "staff", "create")) return forbidden();

  // Máy chủ tự kiểm dữ liệu vào — không tin client đã chạy zod. `actorId`
  // client gửi kèm (di sản cũ) rơi rụng luôn ở bước parse vì không có trong schema.
  const parsed = StaffForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  // Không tạo người vào phòng mình không quản: trần vai và trần quyền vẫn giữ
  // được, nhưng thiếu dòng này thì trục phạm vi thủng.
  if (!inVisibleScope(actor, "staff", "create", parsed.data.departmentId || null))
    return forbidden();

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
