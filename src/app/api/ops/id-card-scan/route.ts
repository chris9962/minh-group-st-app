import { IdCardScanBody } from "@/lib/api/ops";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { idCardScanSetting, saveIdCardScan } from "@/server/idCardScanMode";

/** P-99 · Chụp CCCD khi tạo khách: mức mặc định và danh sách ngoại lệ. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  return Response.json(await idCardScanSetting());
}

/** P-99 · Bật hoặc tắt mức mặc định. Lượt mở form tạo khách kế tiếp dùng giá trị mới, không cần khởi động lại. */
export async function PUT(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  const parsed = IdCardScanBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Giá trị công tắc không hợp lệ");

  await saveIdCardScan(guard.actor, parsed.data.enabled);
  return new Response(null, { status: 204 });
}
