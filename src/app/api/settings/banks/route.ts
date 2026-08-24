import { BankForm } from "@/lib/api/bankCatalog";
import { logAudit } from "@/server/audit";
import { can, visibleBankIds } from "@/lib/permissions";
import { actorWith, signedIn, badRequest, forbidden, jsonBody } from "@/server/auth";
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
  const guard = await actorWith(request, "system", "manage-bank");
  if (!guard.ok) return guard.response;

  /**
   * Lập ngân hàng MỚI chỉ dành cho người quản mọi ngân hàng.
   *
   * Ngân hàng chưa tồn tại thì chưa được giao cho ai, nên người ở phạm vi
   * `listed` lập xong sẽ không sửa được chính thứ mình vừa tạo — và cũng không
   * ai kịp giao nó cho họ trước khi họ bấm Lưu.
   */
  if (visibleBankIds(guard.actor) !== null) return forbidden();

  const parsed = BankForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  // Ngân hàng mới chỉ người `all` lập được (chốt ngay trên), mà muốn giao nó cho
  // ai thì vẫn phải có `grant-permission` — hai quyền khác nhau.
  const form = can(guard.actor, "system", "grant-permission")
    ? parsed.data
    : { ...parsed.data, managerIds: [] };

  const result = await createBank(form);
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
