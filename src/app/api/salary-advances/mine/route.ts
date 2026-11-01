import { AdvanceAmountForm } from "@/lib/api/salaryAdvances";
import { badRequest, jsonBody, signedIn } from "@/server/auth";
import { createMyAdvance, editMyAdvance, myAdvance } from "@/server/salaryAdvances";

/** Yêu cầu tạm ứng tháng này của người đang đăng nhập. Mọi tài khoản đang làm đều gửi được, không cần quyền. */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await myAdvance(guard.actor));
}

async function save(request: Request, editing: boolean) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const parsed = AdvanceAmountForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const result = editing
    ? await editMyAdvance(guard.actor, parsed.data.amount)
    : await createMyAdvance(guard.actor, parsed.data.amount);
  if (!result.ok) return Response.json({ message: result.message }, { status: 409 });
  return Response.json(await myAdvance(guard.actor), { status: editing ? 200 : 201 });
}

export const POST = (request: Request) => save(request, false);
export const PATCH = (request: Request) => save(request, true);
