import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { deleteDraft } from "@/server/banking";

/**
 * Bỏ dở một tài khoản đang tạo — nhả chỗ mã về kho ngay (spec §4.5).
 *
 * Tài khoản đã hoàn thành KHÔNG xoá được: nó đã tiêu một lượt mã và đã vào điểm
 * KPI. Tầng dưới trả `null` cho ca đó, và ở đây thành 404 y như "không có" —
 * phân biệt hai ca là nói cho người gọi biết id nào có thật.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "delete")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const removed = await deleteDraft(actor, id);
  if (!removed) return notFound();

  await logAudit(actor, {
    module: "banking",
    action: "delete",
    targetLabel: `Bỏ dở tài khoản ${removed.bankCode} của ${removed.customerName}, nhả mã ${removed.referralCode}`,
    targetTable: "bank_accounts",
    targetId: removed.id,
  });
  return new Response(null, { status: 204 });
}
