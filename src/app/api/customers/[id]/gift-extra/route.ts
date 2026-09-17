import { z } from "zod";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, jsonBody, notFound, unauthorized } from "@/server/auth";
import { chooseExtraGift } from "@/server/gift";

const Body = z.object({ extraItem: z.string().trim().min(1, "Chưa chọn quà thêm") });

/**
 * Chọn quà thêm HKD cho đợt ĐÃ chốt mà chưa có quà thêm — đợt phát trước
 * 2026-09-17. Cùng quyền với phát quà; máy chủ tự tính lại rổ quà thêm rồi mới kiểm
 * món, không tin rổ client gửi lên.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "grant-gift")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");

  const result = await chooseExtraGift(actor, id, parsed.data.extraItem);
  if (result === null) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });

  await logAudit(actor, {
    module: "banking",
    action: "grant-gift",
    targetLabel: `Quà thêm ${result.customerName}: ${result.label}`,
    targetTable: "gift_grants",
    targetId: result.grantId,
  });
  return Response.json({ ok: true });
}
