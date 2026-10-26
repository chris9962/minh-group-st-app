import { formatDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, isUuid, unauthorized } from "@/server/auth";
import { listBankNotOpenedExport } from "@/server/exports";

/**
 * Màn Xuất dữ liệu, báo cáo Khách không mở ngân hàng (thêm 2026-10-22).
 *
 * Gác `banking:export` và kẹp theo phạm vi của quyền đó, cùng luật với báo cáo
 * Tính điểm tổng. File có số đếm theo người lập hồ sơ, cộng danh sách khách
 * nhóm đủ tuổi mà không mở kèm lý do (thêm 2026-10-26).
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const bankId = params.get("bankId") ?? "";
  if (!isRealIsoDate(from) || !isRealIsoDate(to)) return badRequest("Chọn khoảng ngày lập hồ sơ");
  if (!isUuid(bankId)) return badRequest("Ngân hàng không hợp lệ");

  const result = await listBankNotOpenedExport(actor, { from, to, bankId });
  if (!result) return badRequest("Ngân hàng không hợp lệ");

  await logAudit(actor, {
    module: "banking",
    action: "export",
    targetLabel: `Khách không mở ngân hàng - ${formatDate(from)} đến ${formatDate(to)} - ${result.rows.length} dòng, ${result.customers.length} khách`,
  });

  return Response.json(result);
}
