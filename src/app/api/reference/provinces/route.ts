import { actorWith } from "@/server/auth";
import { listReferenceProvinces } from "@/server/catalog";

/** 34 tỉnh/thành theo dữ liệu nhà nước — chỉ đọc, để CHỌN vào địa bàn công ty. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  return Response.json(await listReferenceProvinces());
}
