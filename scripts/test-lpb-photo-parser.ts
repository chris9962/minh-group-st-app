import assert from "node:assert/strict";
import { checkLpb, displayDate, lpbFacts } from "../src/server/ocr/banks/lpb";

/**
 * Chữ mẫu rút từ ảnh thật LPBank (bộ đo 2026-09-22), mỗi dòng một vùng chữ.
 * Chạy: `bun scripts/test-lpb-photo-parser.ts`.
 */

const accountInfo = `
Thông tin tài khoản
Tài khoản thanh toán
0942854815
Chủ tài khoản SON THI NGOC SANG
Ngày mở tài khoản: 08/09/2026
Chi nhánh PGD LONG PHU
Số dư hiện tại OVND
`;

const referralTab = `
Giới thiệu bạn bè
Mã giới thiệu: 0942854815
Chia sẻ mã giới thiệu
Người giới thiệu của tôi
Mã giới thiệu 0777706075
LƯƠNG THỊ NGỌC ANH
`;

const transferSuccess = `
LPBank
Chuyển tiền thành công
100,000
Tới tài khoản
TRAN THI THU HA
Nội dung
SON THI NGOC SANG chuyen tien
`;

const balanceNotification = `
Biến động số dư.
Số tiền GD: -100,000 VND
Tài khoản: 0942854815 10:26
`;

const qrScreen = `
Mã QR của tôi
Quét mã để chuyển tiền đến
SON THI NGOC SANG
0942854815
`;

const ctx = {
  referralCode: "0777706075",
  referralName: "LƯƠNG THỊ NGỌC ANH",
  customerName: "Sơn Thị Ngọc Sang",
  accountNumber: "0942854815",
  openedDate: "2026-09-08",
};

assert.equal(displayDate("2026-09-08"), "08/09/2026");
assert.equal(displayDate(""), "");

assert.deepEqual(lpbFacts(accountInfo, ctx), {
  nameFound: true,
  accountFound: true,
  codeFound: false,
  successFound: false,
  openedDateFound: true,
});
assert.equal(lpbFacts(referralTab, ctx).codeFound, true);
assert.equal(lpbFacts(referralTab, ctx).accountFound, true, "mã giới thiệu của chính khách là số điện thoại khách");
assert.equal(lpbFacts(transferSuccess, ctx).successFound, true);
assert.equal(lpbFacts(transferSuccess, ctx).nameFound, true, "tên trong lời nhắn chuyen tien");
assert.equal(lpbFacts(balanceNotification, ctx).successFound, true);
assert.equal(lpbFacts(qrScreen, ctx).successFound, false);

assert.equal(lpbFacts(accountInfo, { ...ctx, openedDate: "2026-09-11" }).openedDateFound, false);
assert.equal(lpbFacts(referralTab, { ...ctx, referralCode: "0777706076" }).codeFound, false, "sai một số là người khác");
assert.equal("openedDateFound" in lpbFacts(accountInfo, { ...ctx, openedDate: "" }), false, "chưa có ngày mở thì không so");

const items = checkLpb([qrScreen, accountInfo, referralTab, transferSuccess], ctx);
assert.deepEqual(
  items.map((i) => [i.key, i.verdict, i.photoIndex]),
  [
    ["open", "pass", 2],
    ["home", "pass", 0],
    ["transfer", "pass", 3],
  ],
);
assert.equal(items[1].label, "Tên khách hàng, số tài khoản và ngày mở");
assert.equal(items[1].expected, "Sơn Thị Ngọc Sang - 0942854815 - 08/09/2026");

const missing = checkLpb([qrScreen], { ...ctx, openedDate: "2026-09-11" });
assert.deepEqual(missing[1].issues, ["Không tìm thấy ngày mở tài khoản"]);
assert.equal(missing[1].note, "Không tìm thấy ngày mở 11/09/2026 trong ảnh.");
assert.deepEqual(missing[0].issues, ["Không tìm thấy mã giới thiệu"]);

console.log("LPB: mọi ca đạt.");
