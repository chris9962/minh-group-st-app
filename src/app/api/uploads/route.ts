import { getActor, unauthorized } from "@/server/auth";
import { imageUrl, putImage } from "@/server/storage";

/**
 * NHỊP THỨ NHẤT của luồng tải ảnh: nhận file → đẩy lên kho → trả về URL.
 *
 * KHÔNG ghi database. Nơi gọi cầm URL nhận được rồi gửi vào endpoint nghiệp vụ
 * (`PATCH /api/bank-accounts/:id/photos`) để lưu.
 *
 * Vì sao đẩy qua máy chủ chứ không cho trình duyệt bắn thẳng lên S3: khoá S3
 * không bao giờ rời khỏi máy chủ, và mọi file đi lên đều qua chốt kiểm.
 *
 * Chỉ gác bằng "có phiên đăng nhập", không gác theo module: endpoint này chưa
 * biết ảnh sắp gắn vào đâu, và bản thân nó không lộ dữ liệu của ai. Chốt quyền
 * thật nằm ở nhịp GHI — không có quyền thì URL tải lên được cũng không gắn vào
 * bản ghi nào.
 */
export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  /**
   * Chặn theo `Content-Length` TRƯỚC khi gọi `formData()`.
   *
   * `putImage` có kiểm dung lượng, nhưng tới lúc đó `formData()` đã nạp trọn
   * body vào bộ nhớ rồi. Route Handler của Next không có trần mặc định, nên một
   * tài khoản đăng nhập hợp lệ gửi file 2GB là tiến trình Node phình theo body
   * rồi mới trả 400 — hết RAM, cả app chết, không cần quyền gì thêm.
   *
   * Trần ở đây rộng hơn trần ảnh (10MB) một chút vì `multipart` có phần bao.
   */
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 12 * 1024 * 1024)
    return Response.json(
      { message: "Ảnh nặng quá 10MB." },
      { status: 413 },
    );

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return Response.json({ message: "Không nhận được file ảnh." }, { status: 400 });

  const result = await putImage(file, "bank-accounts");
  if (!result.ok) return Response.json({ message: result.message }, { status: 400 });

  // Trả URL đọc ảnh chứ không trả khoá trần: nơi gọi cần thứ gắn thẳng vào
  // `<img src>` được, và nhịp GHI cắt lại phần đầu để lấy khoá.
  return Response.json({ url: imageUrl(result.key) }, { status: 201 });
}
