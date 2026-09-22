import assert from "node:assert/strict";
import { checkVpb, vpbFacts } from "../src/server/ocr/banks/vpbank";

/**
 * Chữ mẫu lấy từ chữ VietOCR đọc ảnh thật trong bộ đo 2026-09-22 (45 tài
 * khoản VPa), mỗi dòng một vùng chữ. Chạy: `bun scripts/test-vpb-photo-parser.ts`.
 */

const branchStep = `
Lựa chọn chi nhánh thuận tiện giao dịch
Tỉnh/ Thành phố
Dong Thap
Chi nhánh
VPBANK DONG THAP
TÀI KHOẢN CHỨNG KHOÁN VPBANK
VPBank sẽ gửi các thông tin eKYC sang VPBankS để mở tài khoản chứng khoán
Không
Có
2 DAO SALE
49978
LE VAN ANH
Ô MÃ GIỚI THIỆU
MINHAP
Tiếp tục
`;

const registered = `
O Đăng ký thành công
Thông tin về hợp đồng đã được gửi tới email của bạn
Họ và tên
NGUYEN THANH HUY
Số tài khoản
0328539924
Phí mở tài khoản
O VND
Tên đăng nhập VPBankNEO
0328539924
Hạn mức giao dịch
200.000.000 VND/Ngày
`;

/** Ảnh chụp lại điện thoại khách: tiêu đề "Thành công" kèm rác từ dấu tick. */
const securitiesDetail = `
Xong
VPBank
O Thành công
10 000
d
Thông tin thanh toán
CTCP Chứng khoán VNDIRECT
09/09/2026
Thời gian
0001915634
Mã khách hàng
O Chi tiết giao dịch
`;

const transferDetail = `
Chi tiết giao dịch
Chuyển tiền thành
công
10.000
Mười Nghìn Việt Nam Đồng
NGUYEN THANH HUY
NGUYEN NGOC AN
Nội dung
NGUYEN THANH HUY chuyen tien
`;

const history = `
Lịch sử giao dịch E-Bank
Lọc
Hôm nay
10.000 đ
Chuyển tiền
0328539924
NGUYEN THANH HUY chuyen tien
-10.000 đ
Thanh toán hóa đơn
0328539924
VPS Securities
`;

const home = `
VPBank NEO
Chúc một ngày tốt lành
NGUYEN THANH HUY
VP Pay
Quét QR
Chuyển tiền
`;

const ctx = {
  bankCode: "VPa",
  referralCode: "49978",
  customerName: "Nguyễn Thanh Huy",
  accountNumber: "0328539924",
  accountType: "none",
};

assert.deepEqual(vpbFacts(branchStep, ctx), {
  nameFound: false,
  accountFound: false,
  codeFound: true,
  successFound: false,
  programFound: true,
  securitiesFound: false,
});
assert.deepEqual(vpbFacts(registered, ctx), {
  nameFound: true,
  accountFound: true,
  codeFound: false,
  successFound: false,
  programFound: false,
  securitiesFound: false,
});
assert.equal(vpbFacts(registered, ctx).successFound, false, "Đăng ký thành công không phải giao dịch");
assert.equal(vpbFacts(securitiesDetail, ctx).successFound, true);
assert.equal(vpbFacts(securitiesDetail, ctx).securitiesFound, true);
assert.equal(vpbFacts(transferDetail, ctx).successFound, true, "tiêu đề tách hai dòng");
assert.equal(vpbFacts(transferDetail, ctx).securitiesFound, false);
assert.equal(vpbFacts(history, ctx).successFound, true);
assert.equal(vpbFacts(history, ctx).securitiesFound, true, "VPS Securities trong lịch sử");
assert.equal(vpbFacts(home, ctx).nameFound, true);

assert.equal(vpbFacts(branchStep, { ...ctx, referralCode: "49979" }).codeFound, false);
assert.equal(vpbFacts("Thành công\n60 000 đ\nChuyển tiền", { ...ctx, referralCode: "60000" }).codeFound, false, "số tiền không phải mã DAO");
assert.equal(vpbFacts("Họ và tên\nNGUYEN MINH CANH", { ...ctx, accountType: "CNKD" }).programFound, false, "tên khách chứa MINHCA không phải mã");
assert.equal(vpbFacts("VPBank sẽ gửi các thông tin eKYC\nThành công\n10 000 đ\nChi tiết giao dịch", ctx).securitiesFound, false, "VPBank sẽ… không phải VPBankS");
assert.equal(vpbFacts("Đăng ký\nthành công\n200.000.000 VND/Ngày", ctx).successFound, false, "tiêu đề đăng ký tách hai dòng");
assert.equal(vpbFacts("Liên kết ví điện tử\nVPBank\n0328539924", { ...ctx, accountType: "CNKD" }).etaxFound, false, "màn liên kết ví của NEO không phải eTax");
assert.equal(vpbFacts(branchStep.replace("MINHAP", "MINHCA"), ctx).programFound, false, "gõ sai mã giới thiệu công ty");
assert.equal(vpbFacts(branchStep, { ...ctx, bankCode: "VPb" }).programFound, false, "VPb đòi số của QR, không phải MINHAP");
assert.equal(vpbFacts(branchStep.replace("MINHAP", "0948822956"), { ...ctx, bankCode: "VPb" }).programFound, true);
assert.equal(vpbFacts(branchStep.replace("MINHAP", "MINHCA"), { ...ctx, accountType: "CNKD" }).programFound, true, "CNKD gõ MINHCA");
assert.equal("securitiesFound" in vpbFacts(history, { ...ctx, accountType: "CNKD" }), false);

const items = checkVpb([home, branchStep, registered, transferDetail, securitiesDetail], ctx);
assert.deepEqual(
  items.map((i) => [i.key, i.verdict, i.photoIndex]),
  [
    ["open", "pass", 1],
    ["home", "pass", 0],
    ["transfer", "pass", 3],
  ],
);
assert.equal(items[0].label, "Mã DAO và mã giới thiệu");
assert.equal(items[0].expected, "49978 - MINHAP");
assert.equal(items[2].label, "Giao dịch thành công và nạp chứng khoán");

const noSecurities = checkVpb([branchStep, registered, transferDetail], ctx);
assert.deepEqual(noSecurities[2].issues, ["Không tìm thấy giao dịch nạp chứng khoán"]);
assert.equal(noSecurities[2].verdict, "fail");

const wrongCode = checkVpb([branchStep, registered, transferDetail], { ...ctx, referralCode: "12345" });
assert.deepEqual(wrongCode[0].issues, ["Không tìm thấy mã DAO"]);
assert.equal(wrongCode[0].note, "Không tìm thấy mã DAO 12345 trong ảnh.");

/* ── CNKD: mục đích sử dụng và liên kết eTax ─────────────────────────── */

const purposeStep = `
Bước 4: Thông tin bổ sung và dịch vụ
II. Thông tin giao dịch
Mục đích sử dụng tài khoản VPBank
Cá nhân kinh doanh
Tiếp tục
`;

const etaxLink = `
Hủy liên kết tài khoản
Thông tin tài khoản
Tên ngân hàng
Vpbank-Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)
Tên tài khoản
Nguyễn Thanh Huy
Loại liên kết
Số tài khoản
Số tài khoản/Số thẻ
0328539924
Quay lại
Hủy liên kết
`;

const cnkd = { ...ctx, accountType: "CNKD" };
assert.equal(vpbFacts(purposeStep, cnkd).purposeFound, true);
assert.equal(vpbFacts(etaxLink, cnkd).etaxFound, true);
assert.equal(vpbFacts(etaxLink, { ...cnkd, accountNumber: "0328539925" }).etaxFound, false, "eTax phải liên kết đúng số");
assert.equal("securitiesFound" in vpbFacts(history, cnkd), false);
const cnkdItems = checkVpb([branchStep.replace("MINHAP", "MINHCA"), registered, transferDetail, purposeStep, etaxLink], cnkd);
assert.deepEqual(cnkdItems.map((i) => i.verdict), ["pass", "pass", "pass"]);
assert.equal(cnkdItems[0].expected, "49978 - MINHCA - Cá nhân kinh doanh");
assert.equal(cnkdItems[1].label, "Tên khách hàng, số tài khoản và liên kết eTax");
const cnkdMissing = checkVpb([branchStep.replace("MINHAP", "MINHCA"), registered, transferDetail], cnkd);
assert.deepEqual(cnkdMissing[0].issues, ["Không tìm thấy mục đích sử dụng tài khoản"]);
assert.deepEqual(cnkdMissing[1].issues, ["Không tìm thấy màn liên kết eTax"]);

/* ── HKD: không so số tài khoản, mục ba là QR nhận tiền ──────────────── */

const hkdBranch = `
Thông tin quy mô và chi nhánh mở TK
Mã DAO
NGUYỄN THỊ NGỌC
56173
Chi nhánh mở Tài khoản
CN Sài Gòn
Mã người giới thiệu
MINHHKD
`;
const receiveQr = `
QR nhận tiền
QR ĐA NĂNG
THANH TOÁN MỌI ỨNG DỤNG
Thông tin khách hàng
Họ tên
NGUYEN NGOC DUY
Số tài khoản
A0BZLPS513XVJ0LKLHJ
`;
const hkd = { bankCode: "VPa", referralCode: "56173", customerName: "Nguyễn Ngọc Duy", accountNumber: "0785980578", accountType: "HKD" };
const hkdItems = checkVpb([hkdBranch, receiveQr, etaxLink], hkd);
assert.deepEqual(hkdItems.map((i) => [i.verdict, i.label]), [
  ["pass", "Mã DAO và mã giới thiệu"],
  ["pass", "Tên khách hàng và liên kết eTax"],
  ["pass", "QR nhận tiền hoặc yêu cầu mở tài khoản"],
]);
const openRequest = `
Yêu cầu mở tài khoản đã được khởi tạo thành
công. VPBank sẽ thông báo kết quả qua Email đến
khách hàng trong thời gian sớm nhất
Đăng nhập ngày
`;
assert.equal(vpbFacts(openRequest, hkd).successFound, true);
assert.equal(hkdItems[1].expected, "Nguyễn Ngọc Duy");
assert.deepEqual(checkVpb([hkdBranch], hkd)[2].issues, ["Thiếu ảnh QR nhận tiền"]);

console.log("VPB: mọi ca đạt.");
