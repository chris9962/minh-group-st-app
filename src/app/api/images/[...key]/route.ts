import { getActor, notFound, unauthorized } from "@/server/auth";
import { imageKeyOf, readImage } from "@/server/storage";

/**
 * Đọc một tấm ảnh trong kho — cửa DUY NHẤT ra ảnh chứng minh.
 *
 * Bucket ở FPT để private, nên không ai lấy ảnh thẳng từ đó được. `<img src>` trỏ
 * vào đây, route đòi phiên đăng nhập rồi mới đọc file từ kho và trả về.
 *
 * Vì sao đi đường này chứ không ký presigned URL: FE gửi ngược danh sách ảnh về
 * máy chủ lúc lưu (`BankAccountPhotos.uploadPendingPhotos`), nên URL phải CỐ ĐỊNH
 * mới so sánh được giữa hai lần tải trang. URL đã ký thì đổi chữ ký mỗi lần, và
 * tab mở lâu hơn hạn ký là ảnh không tải được nữa.
 *
 * ⚠️ Chốt ở đây là "CÓ PHIÊN ĐĂNG NHẬP", không phải "thấy được bản ghi chứa ảnh".
 * Khoá mang uuid nên không ai dò ra, và người ta chỉ cầm được khoá từ bản ghi họ
 * đã mở được. Nhưng một nhân viên cầm sẵn khoá của bản ghi ngoài tầm nhìn vẫn xem
 * được ảnh đó. Gác theo bản ghi thì phải tra ngược khoá về `bank_account_photos`
 * và `insurance_orders` mỗi lượt xem — chưa làm.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const key = imageKeyOf((await params).key.join("/"));
  if (!key) return notFound();

  const image = await readImage(key);
  if (!image) return notFound();

  return new Response(image.body, {
    headers: {
      "Content-Type": image.contentType,
      /**
       * `private` để chỉ trình duyệt của người xem giữ bản sao, không phải proxy
       * dùng chung nào ở giữa — ảnh này gác theo phiên đăng nhập.
       *
       * `immutable` an toàn vì khoá mang uuid: một khoá chỉ ứng với đúng một tấm
       * ảnh, thay ảnh là sinh khoá mới chứ không ghi đè.
       */
      "Cache-Control": "private, max-age=31536000, immutable",
      // Kho không đoán kiểu file thay trình duyệt — `Content-Type` ở trên suy từ
      // chữ ký thật lúc tải lên, đoán thêm lần nữa chỉ mở đường cho XSS.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
