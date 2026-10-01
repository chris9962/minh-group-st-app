import { z } from "zod";
import { logAudit } from "@/server/audit";
import { badRequest, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { setHandwrittenPhoto } from "@/server/insurance";
import { imageKeyOf, isImageRef } from "@/server/storage";

/** Ảnh giấy viết tay — nhịp thứ hai sau `POST /api/uploads`, cùng lối route `photo`. */
const Body = z.object({
  photoUrl: z.string().trim().min(1).refine(isImageRef).transform((v) => imageKeyOf(v)!),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await setHandwrittenPhoto(actor, id, parsed.data.photoUrl);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  await logAudit(actor, {
    module: "insurance",
    action: "update",
    targetLabel: `Ảnh giấy viết tay đơn ${result.value.orderCode} - ${result.value.customerName}`,
    targetTable: "insurance_orders",
    targetId: id,
  });
  return Response.json(result.value);
}
