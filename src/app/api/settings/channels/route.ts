import { ChannelForm } from "@/lib/api/channelCatalog";
import { logAudit } from "@/server/audit";
import { actorWith, signedIn, badRequest, jsonBody } from "@/server/auth";
import { createChannel, listChannels } from "@/server/catalog";

/** P-70 · Danh mục kênh tiếp cận. */
export async function GET(request: Request) {
  // Danh mục dùng chung: mọi form nghiệp vụ đều phải đọc được để đổ vào ô chọn,
  // nên chỉ chặn ở mức đã đăng nhập. Quyền SỬA bên dưới vẫn gác như cũ.
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  return Response.json(await listChannels());
}

export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "configure-catalog");
  if (!guard.ok) return guard.response;

  const parsed = ChannelForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createChannel(parsed.data);
  if (!result.ok) return badRequest("Tên kênh này đã có");
  const item = result.item;

  await logAudit(guard.actor, {
    module: "system",
    action: "create",
    targetLabel: `Thêm kênh ${item.name}`,
    targetTable: "channels",
    targetId: item.id,
  });
  return Response.json(item, { status: 201 });
}
