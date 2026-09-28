import { ProfileInfoForm } from "@/lib/api/profile";
import { logAudit } from "@/server/audit";
import { badRequest, getActor, jsonBody, unauthorized } from "@/server/auth";
import { ownProfileInfo, updateOwnProfileInfo } from "@/server/staff";

/**
 * Họ tên và số điện thoại của chính người đang gọi, màn Cá nhân.
 *
 * Không gác thêm quyền nào, cùng lý do với route đổi mật khẩu. Người này là ai
 * lấy từ phiên (`getActor`), KHÔNG lấy từ body — nhận id từ client là mở đường
 * sửa hồ sơ của người khác.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const info = await ownProfileInfo(actor.id);
  if (!info) return new Response(null, { status: 404 });
  return Response.json(info);
}

export async function PATCH(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const parsed = ProfileInfoForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message);

  const before = await ownProfileInfo(actor.id);
  const saved = await updateOwnProfileInfo(actor.id, parsed.data);
  if (!before || !saved) return new Response(null, { status: 404 });

  const changes = [
    before.fullName !== saved.fullName ? `Họ tên: ${before.fullName} → ${saved.fullName}` : "",
    before.phone !== saved.phone ? `Số điện thoại: ${before.phone} → ${saved.phone}` : "",
  ].filter(Boolean);
  if (changes.length > 0)
    await logAudit(actor, {
      module: "staff",
      action: "update",
      targetLabel: `Tự sửa thông tin cá nhân - ${changes.join(", ")}`,
      targetTable: "users",
      targetId: actor.id,
    });

  return Response.json(saved);
}
