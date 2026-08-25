import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized, uuidParam } from "@/server/auth";
import { listScoringExport } from "@/server/exports";

/**
 * P-73 báo cáo #1 · Tính điểm tổng, gộp theo khách.
 *
 * Gác BA quyền, không phải một: `banking:export` cho dữ liệu tài khoản,
 * `insurance:view-summary` vì file có cột loại bảo hiểm và biển số xe, và
 * `customer:access-id-number` vì cột CCCD trả số ĐẦY ĐỦ — mọi màn khác chỉ trả
 * 4 số cuối (quyết định 2026-08-02).
 *
 * Thiếu quyền CCCD thì không chặn cả báo cáo, chỉ xoá cột đó ở giao diện —
 * người xuất vẫn cần 46 cột còn lại.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const result = await listScoringExport(actor, {
    search: params.get("search") ?? "",
    bankCode: params.get("bankCode") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    referralCode: params.get("referralCode") ?? "",
    channelId: uuidParam(params.get("channelId")),
    staffId: uuidParam(params.get("staffId")),
    status: params.get("status") ?? "",
  });

  // Cột CCCD chỉ đi ra khi người xuất có quyền đọc số đầy đủ.
  const rows = can(actor, "customer", "access-id-number")
    ? result.rows
    : result.rows.map((r) => ({ ...r, idNumber: "" }));

  await logAudit(actor, {
    module: "banking",
    action: "export",
    targetLabel: `Tính điểm tổng · ${rows.length}/${result.total} khách`,
  });

  return Response.json({ rows, total: result.total });
}
