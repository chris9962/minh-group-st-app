import { CustomerEditLockBody } from "@/lib/api/ops";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { customerEditLock, restoreCustomerEdit, revokeCustomerEdit } from "@/server/customerEditLock";

/** P-99 · Số nhân viên đang bị thu hồi quyền sửa khách. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  return Response.json(await customerEditLock());
}

/** P-99 · Thu hồi hoặc cấp lại quyền sửa khách của Nhân viên, trừ Phòng ATM cộng đồng và Phòng An Sinh. */
export async function PUT(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const parsed = CustomerEditLockBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Thao tác không hợp lệ");

  const count = parsed.data.revoke
    ? await revokeCustomerEdit(guard.actor)
    : await restoreCustomerEdit(guard.actor);
  return Response.json({ count });
}
