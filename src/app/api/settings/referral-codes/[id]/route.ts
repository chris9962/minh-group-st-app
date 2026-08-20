import { ReferralCodeForm } from "@/lib/api/bankCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound } from "@/server/auth";
import { updateReferralCode } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

/**
 * P-61 · Sửa một mã giới thiệu.
 *
 * Mã đã nằm trong kho vẫn phải sửa được: link mở tài khoản (spec §4.4b) thêm
 * sau khi ngân hàng gửi ảnh QR, và tổng số lượt thì ngân hàng cấp thêm theo
 * đợt. Không có đường này thì cách duy nhất là xoá mã đi lập lại — mà xoá mã đã
 * có tài khoản là cắt đứt chúng.
 *
 * Ngân hàng của mã KHÔNG đổi được; `updateReferralCode` từ chối, không bỏ qua
 * trong im lặng như `code` ở `updateBank` — ô này người dùng nhìn thấy và bấm
 * được, nên phải nói rõ vì sao không lưu.
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "banking", "manage-referral-codes");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = ReferralCodeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateReferralCode(id, parsed.data);
  if (!result) return notFound();
  if (!result.ok) return badRequest(result.message);

  await logAudit(guard.actor, {
    module: "banking",
    action: "update",
    targetLabel: `Sửa mã giới thiệu ${result.item.code}`,
    targetTable: "referral_codes",
    targetId: id,
  });
  return Response.json(result.item);
}
