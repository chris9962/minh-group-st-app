import { OrderStatsGroupBy } from "@/lib/api/exports";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import { forbidden, getActor, unauthorized } from "@/server/auth";
import { listOrderStats } from "@/server/exports";

/** `YYYY-MM` có thật. Tháng lạ thì trả tháng làm việc, không trả 400. */
const monthParam = (raw: string | null): string =>
  raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : new Date().toISOString().slice(0, 7);

/**
 * P-73 báo cáo #4 · Số liệu cấp đơn bảo hiểm.
 *
 * Gác bằng `insurance:export` — báo cáo đếm đơn bảo hiểm. Hai cột BHSK đọc
 * `gift_grants`, nhưng chúng chỉ là số đếm gộp theo phòng, không lộ khách nào
 * nhận gì, nên không đòi thêm quyền quà.
 *
 * KHÔNG kẹp phạm vi phòng của người xuất: báo cáo này để đối chiếu toàn công ty
 * với số của Kế toán, cắt bớt phòng là ra file không so được với bản làm tay.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "insurance", "export")) return forbidden();

  const params = new URL(request.url).searchParams;
  const month = monthParam(params.get("month"));
  const parsed = OrderStatsGroupBy.safeParse(params.get("groupBy"));
  const groupBy = parsed.success ? parsed.data : "department";

  const result = await listOrderStats(month, groupBy);

  await logAudit(actor, {
    module: "insurance",
    action: "export",
    targetLabel: `Số liệu cấp đơn ${month} · gộp theo ${groupBy === "department" ? "phòng" : "nhân viên"}`,
  });

  return Response.json(result);
}
