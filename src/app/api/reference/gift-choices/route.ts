import { isUuid, signedIn } from "@/server/auth";
import { listGiftChoices } from "@/server/giftShops";

/** Quà cho modal "Chọn quà tặng từ Shopee". Chỉ cần đăng nhập: nhân viên mở dòng ShopeePay không có quyền catalog. */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;
  const shopId = new URL(request.url).searchParams.get("shopId") ?? "";
  return Response.json(await listGiftChoices(isUuid(shopId) ? shopId : undefined));
}
