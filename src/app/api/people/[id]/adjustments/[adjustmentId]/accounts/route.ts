import { can } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { deductedAccountsFor } from "@/server/vpaTargets";

type Params = { params: Promise<{ id: string; adjustmentId: string }> };

/** P-52 · Tài khoản VPa không đạt nằm trong một dòng điểm trừ. */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  const { id, adjustmentId } = await params;
  if (!isUuid(id) || !isUuid(adjustmentId)) return notFound();
  if (id !== actor.id && !can(actor, "staff", "view-detail")) return forbidden();

  const rows = await deductedAccountsFor(actor, id, adjustmentId);
  return rows ? Response.json(rows) : notFound();
}
