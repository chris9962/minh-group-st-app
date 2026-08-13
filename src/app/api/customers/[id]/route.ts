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
   * MỌI lượt mở hồ sơ khách đều vào nhật ký (`mgst-db-design.md` §3 và §6).
   *
   * Hồ sơ khách không áp trục phạm vi (spec §2.1b) nên mọi nhân viên đọc được
   * địa chỉ và 4 số cuối CCCD của mọi khách trong công ty. Không chốt nào chặn
   * họ, nên nhật ký là thứ duy nhất trả lời được "ai đã đọc hồ sơ này".
   *
   * Lượt thấy số CCCD ĐẦY ĐỦ ghi thành một dòng riêng, hành động
   * `access-id-number`. Hai dòng cho một lượt gọi là cố ý: P-93 có ô lọc theo
   * hành động, nên tra "ai đọc CCCD" vẫn ra đúng tập cũ, không lẫn với lượt mở
   * hồ sơ thường.
   *
   * ⚠️ Bảng phình nhanh hơn hẳn. Ước lượng 17 nhân viên × 30 lượt mở mỗi ngày
   * là khoảng 500 dòng một ngày. Ngày nó thành vấn đề thì cách chữa là gộp —
   * một người xem một khách trong một giờ chỉ ghi một dòng — chứ không phải bỏ
   * ghi.
   */
  await logAudit(guard.actor, {
    module: "customer",
    action: "view-detail",
    targetLabel: `Mở hồ sơ ${detail.customer.fullName}`,
    targetTable: "customers",
    targetId: id,
  });

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
