import assert from "node:assert/strict";
import { checkMsb, msbFacts, msbReferral } from "../src/server/ocr/banks/msb";

/**
 * Chữ mẫu là chữ VietOCR đọc từ ảnh thật trong bộ đo 2026-09-21 (60 tài khoản
 * MSBa + MSBb), mỗi dòng một vùng chữ. Chạy: `bun scripts/test-msb-photo-parser.ts`.
 */

const register = `
Mmsb
Đăng ký dịch vụ MSB Digibank thành
công
Tên đăng nhập
0522514735
Chủ tài khoản
PHAN NGỌC LƯƠNG
Số tài khoản
80003860331
Ngày hiệu lực tài khoản
09/09/2026
`;

const supplement = `
2.3 Bổ sung thông tin
Chi nhánh/PGD
PGD Vụ Bản
Thông tin bổ sung
Mã giới thiệu (Không bắt buộc)
BSJFUXA-5
Mã chương trình (Không bắt buộc)
TIKTOK
Tiếp tục
`;

const transferTitle = `
Chuyển tiền thành công
50,000 VND
15:00 - 09/09/2026
Người nhận
VÔ THI KIỀU TRANG
Người chuyển
PHAN NGOC LUONG
Nội dung chuyển tiền
PHAN NGoc Luong chuyen tien
`;

/** Thông báo đẩy che tiêu đề; tiêu đề đọc thành rác "Chuyen uen uann cong". */
const transferCovered = `
- 50,000 VND
Tài khoản: 800xx1264
ND: 80003881264-Ref 6255MCOBQ2MD3PCX-
Chuyen uen uann cong
50,000 VND
Người nhận
LE HUU DANG
Người chuyển
NGUYEN THI NGOC TRAM
Nội dung chuyển tiền
NGuyen Thi Ngoc TRAM chuyen tien
Hình thức
Chuyển nhanh 24/7
Chi tiết giao dịch
Giao dịch khác
`;

const balanceTab = `
Trung tâm thông báo
Thông báo khác
Biến động số dư
Hôm nay, 12/09/2026
Số tiền
50,000 VND
Tài khoản
80003882939
Nội dung
80003882939-Ref 6255MCOBQ2MD7CY6-
CK 24/7 CHO 1040330053-NGUYEN THI
CHANG chuyen tien
`;

const historyList = `
Tài khoản thanh toán
Số dư tài khoản
O VND
Lịch sử giao dịch
06/09/2026
50,000
TRAN VAN
80003837048-Ref
6249MCOBQ2MXCGGK-C...
`;

/** Màn Chi tiết thẻ: có "Lịch sử giao dịch" và "0 VND" nhưng chưa có giao dịch. */
const cardDetail = `
Chi tiết thẻ
MSB Napas Debit MPRO
Số dư
O VND
80003860331
Tài khoản liên kết
Lịch sử giao dịch
Chưa có giao dịch được thực hiện
Thông tin về giao dịch sẽ hiển thị ở đây
`;

const ctx = {
  referralCode: "BSJFUXA-5 - MCT: TIKTOK",
  customerName: "Phan Ngọc Lương",
  accountNumber: "0522514735",
};

assert.equal(msbReferral(ctx), "BSJFUXA-5");
assert.equal(msbReferral({ referralCode: "MGST2026 - P1" }), "MGST2026");
assert.equal(msbReferral({ referralCode: "MGST2026 (phòng 8)" }), "MGST2026");
assert.equal(msbReferral({ referralCode: "ACT24  - MCT: Trống" }), "ACT24");
// Nhóm DNS960: nhãn nằm ở `display_name`, `code` sạch (chốt 2026-09-22).
assert.equal(msbReferral({ referralCode: "DNS960 (cho phòngY)" }), "DNS960");

assert.deepEqual(msbFacts(register, ctx), { nameFound: true, accountFound: true, codeFound: false, successFound: false });
assert.deepEqual(msbFacts(supplement, ctx), { nameFound: false, accountFound: false, codeFound: true, successFound: false });
assert.equal(msbFacts(transferTitle, ctx).successFound, true);
assert.equal(msbFacts(transferTitle, ctx).nameFound, true, "tên ở Người chuyển và lời nhắn chuyen tien");
assert.equal(msbFacts(transferCovered, ctx).successFound, true, "tiêu đề bị che, còn Người chuyển + Nội dung + Giao dịch khác");
assert.equal(msbFacts(balanceTab, ctx).successFound, true, "tab Biến động số dư kèm nội dung -Ref");
assert.equal(msbFacts(historyList, ctx).successFound, true, "Lịch sử giao dịch của màn Tài khoản thanh toán");
assert.equal(msbFacts(cardDetail, ctx).successFound, false, "Chi tiết thẻ chưa có giao dịch không được tính");

// MSBa lưu số 8000… làm số tài khoản, MSBb lưu số điện thoại: cả hai đều tìm được trên màn đăng ký.
assert.equal(msbFacts(register, { ...ctx, accountNumber: "80003860331" }).accountFound, true);
assert.equal(msbFacts(register, { ...ctx, accountNumber: "0822514735" }).accountFound, false, "gõ sai một số phải không đạt");
assert.equal(msbFacts(supplement, { ...ctx, referralCode: "BSJFUXA-6" }).codeFound, false, "sai một ký tự mã là sai người");
assert.equal(msbFacts(register, { ...ctx, customerName: "Nguyễn Văn Xiêm" }).nameFound, false);

const items = checkMsb([register, supplement, transferCovered], ctx);
assert.deepEqual(
  items.map((i) => [i.key, i.verdict, i.photoIndex]),
  [
    ["open", "pass", 1],
    ["home", "pass", 0],
    ["transfer", "pass", 2],
  ],
);
assert.ok(items.every((i) => i.found === ""), "không đoán giá trị trên ảnh");

const missing = checkMsb([cardDetail], ctx);
assert.deepEqual(
  missing.map((i) => [i.verdict, i.issues]),
  [
    ["fail", ["Không tìm thấy mã giới thiệu"]],
    ["fail", ["Không tìm thấy tên khách hàng", "Không tìm thấy số tài khoản"]],
    ["fail", ["Thiếu ảnh giao dịch thành công"]],
  ],
);
assert.equal(missing[1].note, "Không tìm thấy tên Phan Ngọc Lương trong ảnh. Không tìm thấy số tài khoản 0522514735 trong ảnh.");

const qrOnly = checkMsb([register], { ...ctx, referralCode: "" });
assert.equal(qrOnly[0].verdict, "pass");
assert.equal(qrOnly[0].note, "Mã đã chọn không có mã chữ, không so được.");

console.log("MSB: mọi ca đạt.");
