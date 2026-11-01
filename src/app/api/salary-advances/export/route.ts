import { actorWith, badRequest } from "@/server/auth";
import { advanceExportRows } from "@/server/salaryAdvances";

/** Trọn danh sách theo bộ lọc đang xem cho file Excel của kế toán (AGENTS.md §12): không lấy trang đang hiện. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "close-salary");
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest("Tháng không hợp lệ");

  const rows = await advanceExportRows(guard.actor, month, params);
  if (typeof rows === "string") return Response.json({ message: rows }, { status: 409 });
  return Response.json(rows);
}
