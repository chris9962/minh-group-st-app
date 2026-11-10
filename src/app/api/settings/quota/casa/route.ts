import { CasaImportRequest } from "@/lib/api/casa";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { getCasaMonth, importCasaFile } from "@/server/casa";

const monthFrom = (request: Request): string | null => {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
};

/** Số tài khoản CASA tính vào lương tháng `month`. Cùng quyền với màn Chỉ tiêu tháng. */
export async function GET(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();
  return Response.json(await getCasaMonth(month));
}

/** `commit: false` chỉ trả bảng kiểm. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;
  const month = monthFrom(request);
  if (!month) return badRequest();

  const parsed = CasaImportRequest.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const outcome = await importCasaFile(guard.actor, month, parsed.data);
  if (!outcome.ok) return Response.json({ message: outcome.message }, { status: 422 });

  if (parsed.data.commit)
    await logAudit(guard.actor, {
      module: "system",
      action: "update",
      targetLabel: `Nhập file CASA lương tháng ${month}: ${outcome.result.written} tài khoản`,
      targetTable: "casa_accounts",
    });
  return Response.json(outcome.result);
}
