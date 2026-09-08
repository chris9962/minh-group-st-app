import { can } from "@/lib/permissions";
import { InsuranceProduct } from "@/lib/types";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listCancelledInsuranceExport } from "@/server/insurance";

/**
 * P-73 báo cáo #5 · Đơn bảo hiểm huỷ.
 *
 * Gác bằng `insurance:export`, và `listCancelledInsuranceExport` kẹp thêm phạm
 * vi ghi của người xuất — khác báo cáo #4, vốn là số đếm gộp nên mở toàn công
 * ty. Ở đây mỗi dòng là một đơn có tên khách, nên phạm vi phải theo.
 *
 * Khoảng ngày là NGÀY HUỶ, không phải ngày lập đơn.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const product = InsuranceProduct.safeParse(params.get("product"));

  const result = await listCancelledInsuranceExport(actor, {
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    staffId: uuidParam(params.get("staffId")),
    departmentId: uuidParam(params.get("departmentId")),
    product: product.success ? product.data : "",
  });

  // Lượt xuất nào cũng để lại vết (spec §10.4).
  await logAudit(actor, {
    module: "insurance",
    action: "export",
    targetLabel: `Đơn bảo hiểm huỷ - ${result.rows.length}/${result.total} đơn`,
  });

  return Response.json(result);
}
