import { AnnouncementBody } from "@/lib/api/notifications";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody } from "@/server/auth";
import { notifyEveryone } from "@/server/notifications";

/**
 * C-09 · Gửi thông báo chung cho toàn bộ nhân viên đang hoạt động.
 *
 * Khác mọi đường gửi khác: người bấm là NGƯỜI THẬT, không phải worker hay một
 * bước nghiệp vụ. Hai điều kéo theo:
 *
 * 1. Gác bằng quyền riêng `system:send-announcement`, không dùng chung với
 *    quyền nào có sẵn.
 * 2. Ghi nhật ký truy vấn được. Một lượt bấm là hàng trăm dòng thông báo cộng
 *    hàng trăm gói tin đẩy, và KHÔNG thu hồi được — phải tra ra ai đã gửi.
 *
 * `url` nhận được và người gửi gõ tự do, chỉ đòi bắt đầu bằng `/`. Ràng buộc đó
 * là kỹ thuật: cả hai đường bấm đều mở trong app, địa chỉ ngoài không mở đúng.
 */
export async function POST(request: Request) {
  const guard = await actorWith(request, "system", "send-announcement");
  if (!guard.ok) return guard.response;

  const parsed = AnnouncementBody.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest("Tiêu đề hoặc nội dung không hợp lệ");

  const sent = await notifyEveryone({
    title: parsed.data.title,
    body: parsed.data.body,
    url: parsed.data.url,
  });

  await logAudit(guard.actor, {
    module: "system",
    action: "send-announcement",
    targetLabel: `Gửi thông báo chung cho ${sent} người: ${parsed.data.title}`,
    targetTable: "notifications",
  });

  return Response.json({ sent });
}
