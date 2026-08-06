import { CUSTOMER_ERROR, CustomerForm } from "@/lib/api/customers";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, isUuid, jsonBody, notFound, signedIn } from "@/server/auth";
import { customerDetailFor, updateCustomer } from "@/server/customers";

type Params = { params: Promise<{ id: string }> };

/** P-42 · Hồ sơ 360°. Thông tin khách ai cũng xem được; bản ghi nghiệp vụ theo phạm vi. */
export async function GET(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const detail = await customerDetailFor(guard.actor, id);
  if (!detail) return notFound();

  /**
   * Chỉ ghi nhật ký khi người xem THẬT SỰ nhận được số CCCD đầy đủ — đó là lượt
   * xem nhạy cảm mà P-93 cần lần lại (`server/audit.ts`).
   *
   * Ghi mọi lượt mở hồ sơ thì nhật ký đầy tiếng ồn: nhân viên bấm qua bấm lại
   * mấy chục khách một buổi, và lúc cần tra "ai đã đọc CCCD của khách này" thì
   * phải lọc giữa hàng nghìn dòng vô thưởng vô phạt.
   */
  if (detail.customer.idNumber && !detail.customer.idNumberMasked) {
    await logAudit(guard.actor, {
      module: "customer",
      action: "access-id-number",
      targetLabel: `Xem CCCD của ${detail.customer.fullName}`,
      targetTable: "customers",
      targetId: id,
    });
  }
  return Response.json(detail);
}

/** P-41 · Sửa hồ sơ. Ô CCCD bị bỏ qua khi người sửa không có `access-id-number`. */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await actorWith(request, "customer", "update");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = CustomerForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await updateCustomer(guard.actor, id, parsed.data);
  if (!result) return notFound();
  if (!result.ok) {
    if (!result.existing) return badRequest("Không lưu được hồ sơ khách này");
    return Response.json(
      {
        code: CUSTOMER_ERROR.DUPLICATE_ID,
        message: "CCCD này đã có hồ sơ trong hệ thống",
        existing: result.existing,
      },
      { status: 422 },
    );
  }

  await logAudit(guard.actor, {
    module: "customer",
    action: "update",
    targetLabel: `Sửa khách hàng ${result.customer.fullName}`,
    targetTable: "customers",
    targetId: id,
  });
  return Response.json(result.customer);
}
