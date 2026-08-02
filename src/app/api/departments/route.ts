import { getActor, unauthorized } from "@/server/auth";
import { activeDepartments } from "@/server/org";

/** Danh sách phòng đang hoạt động — đổ vào ô lọc/ô chọn đơn vị. */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  return Response.json(await activeDepartments());
}
