import { signedIn } from "@/server/auth";
import { vapidPublicKey } from "@/server/push";

/**
 * Khoá VAPID công khai của máy chủ, đọc LÚC CHẠY.
 *
 * ⚠️ ĐỪNG đưa khoá này xuống trình duyệt bằng biến `NEXT_PUBLIC_*`. Trình duyệt
 * không có `process.env`, nên Next thay biến đó bằng chuỗi nguyên văn lúc
 * `next build`. Trên máy chủ, `next build` chạy bên trong `docker build`, mà
 * `.dockerignore` loại `.env` và `.env.*` khỏi context. Lúc dựng không có biến
 * nên chuỗi đóng băng là rỗng, và cả khối cài đặt thông báo biến mất mà không
 * báo gì. Máy người viết code không dính vì bản dựng ở đó đọc thẳng `.env.local`
 * trên đĩa.
 *
 * Khoá này công khai đúng nghĩa: trình duyệt phải gửi nó cho dịch vụ đẩy của
 * Apple hay Google mới đăng ký được. Khoá riêng `VAPID_PRIVATE_KEY` không đi
 * qua đường này và không rời máy chủ.
 *
 * Vẫn đòi đăng nhập, cùng lý do với `/api/push/subscribe`: đây là API nội bộ,
 * không có việc gì phải mở cho người lạ.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  return Response.json({ publicKey: vapidPublicKey() });
}
