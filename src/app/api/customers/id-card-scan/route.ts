import { actorWith } from "@/server/auth";
import { idCardScanEnabled } from "@/server/idCardScanMode";

/** P-41 · Form tạo khách hỏi có phải chụp CCCD không; công tắc đổi ở P-99. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "customer", "create");
  if (!guard.ok) return guard.response;

  return Response.json({ enabled: idCardScanEnabled() });
}
