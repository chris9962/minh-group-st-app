import { z } from "zod";
import { can } from "@/lib/permissions";
import { logAudit } from "@/server/audit";
import {
  badRequest,
  forbidden,
  getActor,
  isUuid,
  jsonBody,
  notFound,
  unauthorized,
} from "@/server/auth";
import { setCertificatePhoto } from "@/server/insurance";
import { imageKeyOf, isImageRef } from "@/server/storage";

/**
 * Đính/thay ảnh chứng nhận bảo hiểm — NHỊP THỨ HAI của luồng tải ảnh.
 *
 * Nhịp thứ nhất là `POST /api/uploads`: đẩy file lên kho, trả về URL, không
 * đụng database. Ở đây cắt URL đó về khoá rồi ghi.
 *
 * Ảnh này THAY cho file PDF của PVI (spec §3.3) và dùng được ở MỌI trạng thái
 * đơn — không chờ tới lúc hoàn thành.
 */
const Body = z.object({
  // FE gửi `/api/images/<key>`, database lưu `<key>`. Chốt chặn XSS lưu trữ nằm
  // ở `refine` — xem `KEY_PATTERN` ở `server/storage.ts`.
  photoUrl: z.string().trim().min(1).refine(isImageRef).transform((v) => imageKeyOf(v)!),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  /**
   * `update` HOẶC `handle-fallback`: đội xử lý tay là những người đúng ra phải
   * đính tờ chứng nhận vừa lấy về từ PVI (spec §9.2), nhưng họ không sửa nội
   * dung đơn nên không nhất thiết có `update`. Gác một mình `update` thì cái nút
   * đó nằm chình ình trên P-14 của họ mà bấm vào là 403.
   */
  if (!can(actor, "insurance", "update") && !can(actor, "insurance", "handle-fallback"))
    return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const order = await setCertificatePhoto(actor, id, parsed.data.photoUrl);
  if (!order) return notFound();

  await logAudit(actor, {
    module: "insurance",
    action: "update",
    targetLabel: `Ảnh chứng nhận đơn ${order.orderCode} · ${order.customerName}`,
    targetTable: "insurance_orders",
    targetId: id,
  });
  return Response.json(order);
}
