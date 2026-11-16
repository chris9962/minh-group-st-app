import { after } from "next/server";
import { VpaTargetImportRequest } from "@/lib/api/vpaTargets";
import { canImportVpaTargets } from "@/lib/permissions";
import { actorPassing, badRequest, jsonBody } from "@/server/auth";
import { afterVpaTargetCommit, importVpaTargetFile } from "@/server/vpaTargets";

/** `commit: false` chỉ trả bảng kiểm. `month` là tháng lương nhận điểm trừ và CASA. */
export async function POST(request: Request) {
  const guard = await actorPassing(request, canImportVpaTargets);
  if (!guard.ok) return guard.response;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest();

  const parsed = VpaTargetImportRequest.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const outcome = await importVpaTargetFile(guard.actor, month, parsed.data);
  if (!outcome.ok) return Response.json({ message: outcome.message }, { status: 422 });

  // Vài trăm thông báo đẩy đi lần lượt, không bắt người bấm Ghi chờ.
  if (parsed.data.commit) after(() => afterVpaTargetCommit(guard.actor, month, outcome.result));
  return Response.json(outcome.result.result);
}
