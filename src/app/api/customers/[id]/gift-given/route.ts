import { z } from "zod";
import { GIFT_DECLINED } from "@/lib/api/customers";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { grantGift } from "@/server/gift";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ item: z.string().trim().min(1) });

/**
 * P-43 · Chốt quà — đúng MỘT lần cho mỗi khách, không có đợt thứ hai
 * (spec §4.4).
 *
 * Máy chủ tự tính lại rổ quà rồi mới kiểm món chọn: rổ đi qua đường truyền là
 * rổ CLIENT nói, mà quà có món là hợp đồng bảo hiểm hai năm. Nhận tên món tuỳ ý
 * nghĩa là ai cũng tự phát cho mình bất cứ thứ gì bằng một câu lệnh gõ tay.
 */
export async function POST(request: Request, { params }: Params) {
  const guard = await actorWith(request, "banking", "grant-gift");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Chưa chọn món quà nào");

  const result = await grantGift(guard.actor, id, parsed.data.item);
  if (!result) return notFound();

  if (!result.ok)
    return Response.json({ code: result.code, message: result.message }, { status: 422 });

  await logAudit(guard.actor, {
    module: "banking",
    action: "grant-gift",
    targetLabel:
      parsed.data.item === GIFT_DECLINED
        ? `${result.customerName} từ chối nhận quà`
        : `Tặng ${parsed.data.item} cho ${result.customerName}`,
    targetTable: "gift_grants",
    targetId: id,
  });

  return Response.json({ ok: true });
}
