import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { actorWith } from "@/server/auth";
import { listSocialInsuranceForExport, socialInsuranceFiltersFrom } from "@/server/socialInsurance";

/** TRỌN danh sách khớp bộ lọc cho nút Xuất Excel, gác bằng `social-insurance:export`. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "social-insurance", "export");
  if (!guard.ok) return guard.response;

  const listed = await listSocialInsuranceForExport(
    guard.actor,
    socialInsuranceFiltersFrom(new URL(request.url).searchParams),
  );
  // Cột CCCD chỉ đi ra khi người xuất có quyền đọc số đầy đủ, như file "Tính điểm tổng".
  const result = can(guard.actor, "customer", "access-id-number")
    ? listed
    : { ...listed, rows: listed.rows.map((r) => ({ ...r, idNumber: null })) };
  await logAudit(guard.actor, {
    module: "social-insurance",
    action: "export",
    targetLabel: `BHYT/BHXH - ${result.rows.length}/${result.total} dòng`,
  });
  return Response.json(result);
}
