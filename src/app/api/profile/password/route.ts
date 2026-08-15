import { PASSWORD_ERROR, PasswordForm } from "@/lib/api/profile";
import { logAudit } from "@/server/audit";
import { badRequest, getActor, jsonBody, sessionHashFrom, unauthorized } from "@/server/auth";
import { changeOwnPassword } from "@/server/staff";

/**
 * C-02 · Tự đổi mật khẩu của chính mình.
 *
 * Không gác thêm quyền nào: ai đăng nhập được thì đổi được mật khẩu của chính
 * họ. Người này là ai lấy từ phiên (`getActor`), KHÔNG lấy từ body — nhận id từ
 * client là mở đường đổi mật khẩu của người khác.
 */
export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const parsed = PasswordForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const changed = await changeOwnPassword(actor.id, parsed.data, sessionHashFrom(request));
  if (!changed)
    return Response.json(
      { code: PASSWORD_ERROR.WRONG_CURRENT, message: "Mật khẩu hiện tại không đúng" },
      { status: 400 },
    );

  await logAudit(actor, {
    module: "staff",
    action: "update",
    targetLabel: "Tự đổi mật khẩu",
    targetTable: "users",
    targetId: actor.id,
  });
  return Response.json({ ok: true });
}
