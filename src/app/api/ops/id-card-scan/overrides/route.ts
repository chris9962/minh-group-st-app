import { IdCardScanOverrideBody } from "@/lib/api/ops";
import { actorWith, badRequest, jsonBody, uuidParam } from "@/server/auth";
import { removeIdCardScanOverride, saveIdCardScanOverride } from "@/server/idCardScanMode";

/** P-99 · Thêm hoặc đổi ngoại lệ chụp CCCD của một người. */
export async function PUT(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const parsed = IdCardScanOverrideBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Ngoại lệ không hợp lệ");

  const saved = await saveIdCardScanOverride(guard.actor, parsed.data.userId, parsed.data.enabled);
  if (!saved) return badRequest("Không tìm thấy nhân viên này");
  return new Response(null, { status: 204 });
}

/** P-99 · Bỏ ngoại lệ, người đó quay về theo mức mặc định. */
export async function DELETE(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const userId = uuidParam(new URL(request.url).searchParams.get("userId"));
  if (!userId) return badRequest("Thiếu nhân viên");

  await removeIdCardScanOverride(guard.actor, userId);
  return new Response(null, { status: 204 });
}
