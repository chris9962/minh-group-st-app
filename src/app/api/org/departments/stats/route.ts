import { can } from "@/lib/permissions";
import { forbidden, getActor, unauthorized } from "@/server/auth";

/**
 * Số liệu nghiệp vụ theo phòng (TK mở, App cài…) — DB chưa có bảng nghiệp vụ
 * (bank_accounts, insurance_orders… thuộc đợt sau) nên trả rỗng; FE tự hiện
 * "—" cho phòng không có dòng. Khi module ngân hàng rời mock thì thay bằng
 * aggregate thật, dùng chung công thức với dashboard P-80.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "system", "manage-org")) return forbidden();

  return Response.json({ departments: [] });
}
