import { inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { banks, giftItems } from "../src/server/db/schema";

/**
 * Thêm ví ShopeePay vào danh mục ngân hàng và món "Combo quà tặng ShopeePay"
 * vào danh mục quà, cho kỳ luật 2026-11-11. Hai mã phải khớp đúng chuỗi trong
 * `src/rules/2026-11-11.ts` (`ShopeePay`, `QUA-SHOPEEPAY`).
 *
 * Dòng đã có thì giữ nguyên, chạy lại không đổi gì. Số ảnh, hướng dẫn, mã giới
 * thiệu và người quản lý của ShopeePay sửa ở màn Ngân hàng sau khi chạy.
 *
 *   bun run db:seed-shopeepay
 */
const BANK_CODE = "ShopeePay";
// Link khởi đầu; sau đó sửa ở ô "Link QR" của hộp Sửa ngân hàng.
const QR_LINK =
  "https://shopee.vn/bachhoapp?uls_trackid=573f3m8q01jv&utm_content=MM5vmHFhDAfLWW5fPqAv8SkRjyR";
const GIFT = { code: "QUA-SHOPEEPAY", name: "Combo quà tặng ShopeePay" };

async function main() {
  // ShopeePay không phải ngân hàng nên không đếm như một app.
  const bank = await db
    .insert(banks)
    .values({ code: BANK_CODE, countsAsApp: false, requiredPhotos: 6, qrLink: QR_LINK })
    .onConflictDoNothing({ target: banks.code })
    .returning({ id: banks.id });
  const gift = await db
    .insert(giftItems)
    .values(GIFT)
    .onConflictDoNothing({ target: giftItems.code })
    .returning({ id: giftItems.id });

  console.log(bank.length > 0 ? `Đã thêm ngân hàng ${BANK_CODE}.` : `Ngân hàng ${BANK_CODE} đã có, giữ nguyên.`);
  console.log(gift.length > 0 ? `Đã thêm món ${GIFT.code}.` : `Món ${GIFT.code} đã có, giữ nguyên.`);

  const [found] = await db.select({ code: banks.code, active: banks.active }).from(banks).where(inArray(banks.code, [BANK_CODE]));
  console.log(`Trạng thái: ${found.code}, ${found.active ? "đang triển khai" : "ngừng triển khai"}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
