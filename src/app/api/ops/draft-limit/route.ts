import { DraftLimitBody } from "@/lib/api/ops";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { draftLimitSetting, saveDraftLimit } from "@/server/draftLimit";

/** P-99 · Trần mã giới thiệu mỗi nhân viên: mức mặc định và danh sách ngoại lệ. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  return Response.json(await draftLimitSetting());
}

/** P-99 · Đổi mức mặc định. Lượt mở tài khoản kế tiếp dùng giá trị mới, không cần khởi động lại. */
export async function PUT(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const parsed = DraftLimitBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Trần phải là số nguyên từ 1 đến 99");

  await saveDraftLimit(guard.actor, parsed.data.limits);
  return new Response(null, { status: 204 });
}
