import { recountReferralCodes } from "../src/server/catalog";

/**
 * Đếm lại `referral_codes.used_count` / `holding_count`, KHÔNG đụng gì khác.
 *
 * Khác `db:recount` ở chỗ bỏ qua `customers.account_count`,
 * `customers.insurance_count` và `customers.gift_basket`. Cần lệnh hẹp này vì
 * `recountGiftCases` chỉ đọc tài khoản `done`, trong khi
 * `markAccountErrorByBankManager` CỐ Ý không tính lại rổ quà lúc đánh lỗi
 * (`server/banking.ts`). Chạy bản rộng là ghi đè quyết định đó và co rổ quà của
 * mọi khách đang có tài khoản `error`.
 *
 * Chạy khi: vừa lên bản có migration 0074, hoặc nghi số chỗ của mã lệch.
 */
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const drift = await recountReferralCodes();

  if (drift.length === 0) {
    console.log("Không có mã giới thiệu nào lệch.");
  } else {
    console.log(`${drift.length} mã giới thiệu lệch:`);
    for (const r of drift) console.log(" ", JSON.stringify(r));
  }

  console.log("Đếm lại xong.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
