import { can } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { bankAccountDetail } from "@/server/banking";

/** P-22 · Chi tiết một tài khoản, hoặc màn bước 2 khi còn `creating`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "view-detail")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // Ngoài tầm nhìn trả 404 y hệt "không tồn tại" — 403 là xác nhận id có thật.
  const detail = await bankAccountDetail(actor, id);
  return detail ? Response.json(detail) : notFound();
}
