import { logAudit } from "@/server/audit";
import { getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { approveFixedAccount } from "@/server/banking";

/**
 * Duyệt tài khoản đã sửa sau khi bị đánh lỗi — `Chờ duyệt lại` → `Hoàn thành`.
 *
 * KHÔNG gác `banking:update` ở đây: quyền đó nhân viên cũng có ở phạm vi tài
 * khoản mình mở. Chốt quyền nằm trong `approveFixedAccount`, đọc `canManageBank`
 * theo đúng ngân hàng của tài khoản.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  // Ngoài quyền quản ngân hàng trả 404, không phải 403 — 403 xác nhận id có thật.
  const result = await approveFixedAccount(actor, id);
  if (!result) return notFound();
  if (!result.ok) return Response.json({ message: result.message }, { status: 422 });

  const account = result.value;
  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Duyệt tài khoản đã sửa ${account.bankCode} của ${account.customerName}`,
    targetTable: "bank_accounts",
    targetId: account.id,
  });
  return Response.json(account);
}
