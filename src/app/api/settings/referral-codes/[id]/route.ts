import { ReferralCodeForm } from "@/lib/api/bankCatalog";
import { canManageBank } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, forbidden, isUuid, jsonBody, notFound } from "@/server/auth";
import { bankIdOfReferralCode, updateReferralCode } from "@/server/catalog";

type Params = { params: Promise<{ id: string }> };

/**
 * P-61 · Sửa một mã giới thiệu.
 *
 * Mã đã nằm trong kho vẫn phải sửa được: link mở tài khoản và ảnh QR (spec
 * §4.4b) thêm sau khi ngân hàng gửi, và tổng số lượt thì ngân hàng cấp thêm
 * theo đợt. Không có đường này thì cách duy nhất là xoá mã đi lập lại — mà xoá mã đã
 * có tài khoản là cắt đứt chúng.
 *
 * Ngân hàng của mã KHÔNG đổi được; `updateReferralCode` từ chối, không bỏ qua
 * trong im lặng như `code` ở `updateBank` — ô này người dùng nhìn thấy và bấm
 * được, nên phải nói rõ vì sao không lưu.
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "system", "manage-bank");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = ReferralCodeForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  /**
   * Chốt phạm vi đọc ngân hàng THẬT của mã, không đọc `parsed.data.bankId`.
   *
   * `updateReferralCode` vốn từ chối mọi lượt đổi ngân hàng, nhưng đó là phép
   * kiểm khác việc khác. Tin thân request ở đây thì người ngoài phạm vi gửi
   * `bankId` của ngân hàng mình quản là sửa được mã của ngân hàng bất kỳ.
   */
  const bankId = await bankIdOfReferralCode(id);
  if (!bankId) return notFound();
  if (!canManageBank(guard.actor, bankId)) return forbidden();

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
