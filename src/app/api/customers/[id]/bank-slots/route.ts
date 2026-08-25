import { can } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { customerBankSlots } from "@/server/banking";

/**
 * P-20 bước 1 — ngân hàng nào khách đã mở, còn mở thêm được mấy tài khoản.
 *
 * Gác bằng `banking:create` chứ không phải `signedIn`: chỉ người mở được tài
 * khoản mới cần con số này.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "create")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const slots = await customerBankSlots(id);
  return slots ? Response.json(slots) : notFound();
}
