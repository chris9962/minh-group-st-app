import { z } from "zod";
import { PHOTO_MAX } from "@/lib/api/bankAccounts";
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
import { imageKeyOf, isImageRef } from "@/server/storage";

/**
 * Ghi danh sách ảnh — NHỊP THỨ HAI của luồng tải ảnh.
 *
 * Nhịp thứ nhất là `POST /api/uploads`: đẩy file lên kho, trả về URL, không
 * đụng database. Ở đây cắt URL đó về khoá rồi ghi. Tách vậy để một lần tải hỏng
 * giữa chừng không kéo theo cả bản ghi, và để đổi chỗ lưu trữ về sau không phải
 * sửa tầng nghiệp vụ.
 *
 * Mảng gửi lên ĐÃ là trạng thái mong muốn (thêm, thay, xoá, đổi thứ tự đều
 * chung một đường), không phải một lệnh "thêm vào".
 *
 * `kind` chọn nhóm ảnh: `opening` là ảnh chứng minh của bước 2, `transaction`
 * là ảnh chuyển khoản của bước 3. Mỗi lượt ghi chỉ đụng đúng nhóm của nó.
 */
const Body = z.object({
  /**
   * FE gửi `/api/images/<key>`, database lưu `<key>`. `imageKeyOf` cắt phần đầu.
   *
   * Chốt chặn XSS lưu trữ nằm ở `refine` — xem `KEY_PATTERN` ở `server/storage.ts`.
   * Nhận chuỗi bất kỳ ở đây là mở đường cho `javascript:` chạy trong phiên của
   * người xem, vì ô ảnh của P-22 là một `<a href>`.
   */
  photoUrls: z
    .array(z.string().trim().min(1).refine(isImageRef).transform((v) => imageKeyOf(v)!))
    .max(PHOTO_MAX),
  // Mặc định `opening` để bản client cũ còn gọi được — nhóm này là nhóm có
  // chốt số lượng, tức mặc định nghiêm hơn, không phải lỏng hơn.
  kind: z.enum(["opening", "transaction"]).default("opening"),
});

const PHOTO_LABEL = { opening: "Ảnh chứng minh", transaction: "Ảnh giao dịch" } as const;

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

  const { photoUrls, kind } = parsed.data;
  const account = await setPhotos(actor, id, photoUrls, kind);
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

  const kept =
    kind === "opening" ? account.photoUrls.length : account.transactionPhotoUrls.length;
  await logAudit(actor, {
    module: "banking",
    action: "update",
    targetLabel: `${PHOTO_LABEL[kind]} tài khoản ${account.bankCode} của ${account.customerName} — còn ${kept} ảnh`,
    targetTable: "bank_accounts",
    targetId: id,
  });
  return Response.json(account);
}
