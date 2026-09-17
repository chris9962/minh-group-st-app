import { z } from "zod";
import { GIFT_DECLINED } from "@/lib/api/customers";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { grantGift } from "@/server/gift";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({
  item: z.string().trim().min(1),
  orderIds: z.array(z.string()).default([]),
  /** Quà phụ HKD — mã món hoặc `DECLINED`; `null` khi khách không có rổ phụ. */
  extraItem: z.string().trim().min(1).nullable().default(null),
});

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

  const result = await grantGift(
    guard.actor,
    id,
    parsed.data.item,
    parsed.data.orderIds,
    parsed.data.extraItem,
  );
  if (!result) return notFound();

  if (!result.ok)
    return Response.json({ code: result.code, message: result.message }, { status: 422 });

  // Từ chối cả quà chính lẫn quà phụ mới là "từ chối nhận quà"; từ chối quà
  // chính mà lấy Loa thì vẫn là một lượt tặng.
  const declinedAll =
    parsed.data.item === GIFT_DECLINED &&
    (parsed.data.extraItem === null || parsed.data.extraItem === GIFT_DECLINED);

  await logAudit(guard.actor, {
    module: "banking",
    action: "grant-gift",
    // `itemLabel` là TÊN món, không phải mã: nhật ký hoạt động để người đọc, mà
    // `BH-1N-XEMAY` thì phải đi tra danh mục mới hiểu.
    targetLabel: declinedAll
      ? `${result.customerName} từ chối nhận quà`
      : `Tặng ${result.itemLabel} cho ${result.customerName}`,
    targetTable: "gift_grants",
    targetId: id,
  });

  return Response.json({ ok: true });
}
