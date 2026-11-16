import { actorWith, badRequest } from "@/server/auth";
import { getCasaMonth } from "@/server/casa";

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
