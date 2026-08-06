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
import { setPhotos } from "@/server/banking";
import { isStorageUrl } from "@/server/storage";

/**
 * Ghi danh sách ảnh chứng minh — NHỊP THỨ HAI của luồng tải ảnh.
 *
 * Nhịp thứ nhất là `POST /api/uploads`: đẩy file lên kho, trả về URL, không
 * đụng database. Ở đây chỉ nhận URL rồi ghi. Tách vậy để một lần tải hỏng giữa
 * chừng không kéo theo cả bản ghi, và để đổi chỗ lưu trữ về sau không phải sửa
 * tầng nghiệp vụ.
 *
 * Mảng gửi lên ĐÃ là trạng thái mong muốn (thêm, thay, xoá, đổi thứ tự đều
 * chung một đường), không phải một lệnh "thêm vào".
 */
const Body = z.object({
  // Chốt chặn XSS lưu trữ — xem `isStorageUrl` ở `server/storage.ts`. Nhận chuỗi
  // bất kỳ ở đây là mở đường cho `javascript:` chạy trong phiên của người xem.
  photoUrls: z.array(z.string().trim().min(1).refine(isStorageUrl)).max(20),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "banking", "update")) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound();

  const parsed = Body.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const account = await setPhotos(actor, id, parsed.data.photoUrls);
  if (!account) return notFound();
  // Tài khoản đã hoàn thành không được tụt xuống dưới mức ảnh bắt buộc — nếu
  // không thì đây là đường vòng để lách chốt ảnh của bước 2.
  if ("tooFew" in account)
    return Response.json(
      {
        message: `Tài khoản đã hoàn thành phải giữ đủ ${account.tooFew} ảnh chứng minh. Thay ảnh thì được, bớt thì không.`,
      },
      { status: 422 },
    );

  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `Ảnh chứng minh tài khoản ${account.bankCode} của ${account.customerName} — còn ${account.photoUrls.length} ảnh`,
    targetTable: "bank_accounts",
    targetId: id,
  });
  return Response.json(account);
}
