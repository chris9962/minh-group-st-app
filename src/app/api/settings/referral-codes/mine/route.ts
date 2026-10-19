import { signedIn } from "@/server/auth";
import { listMyReferralCodes } from "@/server/catalog";

/**
 * Mã Trưởng phòng đã chia cho CHÍNH người gọi, kèm số đã dùng — modal "Mã của
 * tôi" ở màn Ngân hàng (chốt 2026-10-19). Chỉ đọc phần của mình nên không cần
 * quyền nào ngoài đăng nhập; mã text và QR không có trong payload.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  // `all=1` = thấy cả mã đã đầy và đã ngừng (ô tích trong modal, chốt 2026-10-19).
  const all = new URL(request.url).searchParams.get("all") === "1";
  return Response.json(await listMyReferralCodes(guard.actor.id, !all));
}
