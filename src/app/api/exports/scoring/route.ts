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

  const params = new URL(request.url).searchParams;
  const staffId = uuidParam(params.get("staffId"));

  /**
   * `omitPii=1` — bảng hiện trên màn, KHÔNG phải file Excel (chốt 2026-09-04).
   *
   * Máy chủ bỏ CCCD và số điện thoại khỏi mỗi dòng, nên lượt gọi này không mang
   * dữ liệu định danh nào. Nhờ vậy người TỰ XEM MÌNH đi qua được mà không cần
   * `banking:export`: chức vụ Nhân viên không có quyền đó, mà bảng điểm của
   * chính họ thì họ phải xem được.
   *
   * Không có cờ, hoặc xem người khác: vẫn gác `banking:export` như cũ.
   */
  const omitPii = params.get("omitPii") === "1";
  const selfView = omitPii && staffId === actor.id;
  if (!selfView && !can(actor, "banking", "export")) return forbidden();

  const result = await listScoringExport(actor, {
    search: params.get("search") ?? "",
    bankCode: params.get("bankCode") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    referralCode: params.get("referralCode") ?? "",
    channelId: uuidParam(params.get("channelId")),
    staffId,
    departmentId: uuidParam(params.get("departmentId")),
    status: params.get("status") ?? "",
  },
  // Giá trị lạ rơi về `with-accounts` — hình dạng cũ, cùng lối với khoá sắp xếp.
  params.get("include") === "all" ? "all" : "with-accounts",
  omitPii,
  // Người tự xem mình đọc đúng bản ghi của chính họ, không rộng hơn một dòng.
  selfView ? { kind: "creator", userId: actor.id } : undefined);

  // Cột CCCD chỉ đi ra khi người xuất có quyền đọc số đầy đủ.
  const rows = can(actor, "customer", "access-id-number")
    ? result.rows
    : result.rows.map((r) => ({ ...r, idNumber: "" }));

  // Nhãn ghi luôn phạm vi khách: hai lượt xuất cùng bộ lọc mà khác chế độ ra hai
  // số khác nhau, không ghi thì tra nhật ký về sau không phân biệt được.
  await logAudit(actor, {
    module: "banking",
    action: "export",
    targetLabel: `Tính điểm tổng · ${rows.length}/${result.total} khách · ${
      params.get("include") === "all" ? "tất cả khách" : "khách có tài khoản"
    }`,
  });

  return Response.json({ rows, total: result.total });
}
