import { AdvanceActionForm, AdvanceAmountForm } from "@/lib/api/salaryAdvances";
import { formatVnd } from "@/lib/format";
import { logAudit } from "@/server/audit";
import { badRequest, isUuid, jsonBody, notFound, signedIn } from "@/server/auth";
import { actOnAdvance, advanceDetail, updateAdvanceAmount } from "@/server/salaryAdvances";

type Params = { params: Promise<{ id: string }> };

/** Yêu cầu và lịch sử. Người gửi, Trưởng phòng của phòng đó và kế toán đọc được. */
export async function GET(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const detail = await advanceDetail(guard.actor, id);
  return detail ? Response.json(detail) : notFound();
}

/** Trưởng phòng hoặc kế toán sửa số tiền. Máy chủ quyết định ai được sửa theo trạng thái và mốc giờ. */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = AdvanceAmountForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const result = await updateAdvanceAmount(guard.actor, id, parsed.data.amount);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  await logAudit(guard.actor, {
    ...(result.as === "head"
      ? { module: "staff", action: "approve-advance" }
      : { module: "system", action: "close-salary" }),
    targetLabel: `Sửa tạm ứng lương tháng ${result.month} của ${result.fullName} thành ${formatVnd(parsed.data.amount)}`,
    targetTable: "salary_advance_requests",
    targetId: id,
  });
  return Response.json({ ok: true });
}

/** Duyệt hoặc từ chối. */
export async function POST(request: Request, { params }: Params) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const parsed = AdvanceActionForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const result = await actOnAdvance(guard.actor, id, parsed.data);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  const verb = parsed.data.action === "approve" ? "Duyệt" : "Từ chối";
  await logAudit(guard.actor, {
    ...(result.as === "head"
      ? { module: "staff", action: "approve-advance" }
      : { module: "system", action: "close-salary" }),
    targetLabel: `${verb} tạm ứng lương tháng ${result.month} của ${result.fullName}`,
    targetTable: "salary_advance_requests",
    targetId: id,
  });
  return Response.json({ ok: true });
}
