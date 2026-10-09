import { DraftLimitOverrideBody } from "@/lib/api/ops";
import { actorWith, badRequest, jsonBody, uuidParam } from "@/server/auth";
import { removeDraftLimitOverride, saveDraftLimitOverride } from "@/server/draftLimit";

/** P-99 · Thêm hoặc đổi trần mã giới thiệu riêng của một người. */
export async function PUT(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const parsed = DraftLimitOverrideBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Trần phải là số nguyên từ 1 đến 99");

  const saved = await saveDraftLimitOverride(guard.actor, parsed.data.userId, parsed.data.limits);
  if (!saved) return badRequest("Không tìm thấy nhân viên này");
  return new Response(null, { status: 204 });
}

/** P-99 · Bỏ ngoại lệ, người đó quay về theo mức mặc định. */
export async function DELETE(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const userId = uuidParam(new URL(request.url).searchParams.get("userId"));
  if (!userId) return badRequest("Thiếu nhân viên");

  await removeDraftLimitOverride(guard.actor, userId);
  return new Response(null, { status: 204 });
}
