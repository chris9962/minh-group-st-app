import { actorWith } from "@/server/auth";
import { zaloPgdOptions } from "@/server/zaloBot";

/** Màn Bot Zalo · Phó giám đốc đang làm, để chọn vào thông báo báo cáo ngày. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "view-ops");
  if (!guard.ok) return guard.response;

  return Response.json(await zaloPgdOptions());
}
