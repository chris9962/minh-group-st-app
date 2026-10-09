import { actorWith } from "@/server/auth";
import { idCardScanFor } from "@/server/idCardScanMode";

/** P-41 · Form tạo khách hỏi người đang đăng nhập có phải chụp CCCD không; cài đặt đổi ở P-99. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "customer", "create");
  if (!guard.ok) return guard.response;

  return Response.json({ enabled: await idCardScanFor(guard.actor.id) });
}
