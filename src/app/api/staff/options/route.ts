import { can } from "@/lib/permissions";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listStaffOptions } from "@/server/staff";

/**
 * Danh sách nhân viên rút gọn, trọn bộ trong phạm vi người gọi.
 *
 * Vẫn đòi `view-detail` như route danh sách: payload có số điện thoại và chức
 * danh. Rút gọn ở đây nghĩa là bỏ BẢNG QUYỀN, không phải hạ mức gác.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "view-detail")) return forbidden();

  const params = new URL(request.url).searchParams;
  return Response.json(
    await listStaffOptions(actor, {
      departmentId: uuidParam(params.get("departmentId")),
      status: params.get("status") === "all" ? "all" : "active",
    }),
  );
}
