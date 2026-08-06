import { BankForm } from "@/lib/api/bankCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, signedIn, badRequest, jsonBody } from "@/server/auth";
import { createBank, listBanks } from "@/server/catalog";

/** P-60 · Danh sách ngân hàng. */
export async function GET(request: Request) {
  // Danh mục dùng chung: mọi form nghiệp vụ đều phải đọc được để đổ vào ô chọn,
  // nên chỉ chặn ở mức đã đăng nhập. Quyền SỬA bên dưới vẫn gác như cũ.
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await listBanks());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "banking", "manage-bank-catalog");
  if (!guard.ok) return guard.response;

  const parsed = BankForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createBank(parsed.data);
  if (!result.ok) return badRequest("Mã ngân hàng này đã có");

  await logAudit(guard.actor, {
    module: "banking",
    action: "create",
    targetLabel: `Thêm ngân hàng ${result.item.code}`,
    targetTable: "banks",
    targetId: result.item.id,
  });
  return Response.json(result.item, { status: 201 });
}
