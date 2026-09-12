import assert from "node:assert/strict";
import { photoCheckIssueLabels } from "../src/lib/api/photoCheck";
import {
  checkMsb,
  parseMsbOpenSuccess,
  parseMsbSupplement,
  parseMsbTransfer,
} from "../src/server/ocr/banks/msb";

const open = `
MSB
Đăng ký dịch vụ MSB Digibank thành
công!
Tên đăng nhập
0354257408
Chủ tài khoản
VÕ THANH HẰNG
Số tài khoản
80003855100
`;

const photographedOpen = `
MSB
@ Đăng ký dịch vụ MSB Digibank
thành công!
0939992947
PHAN VĂN PHÚC
80003854937
08/09/2026
`;

const supplement = `
2.3 Bổ sung thông tin
Chi nhánh/PGD
PGD Thuận An x
Thông tin bổ sung
Mã giới thiệu (Không bắt buộc)
CIUSTSF-5
Mã chương trình (Không bắt buộc)
TIKTOK
`;

const transfer = `
MSB
Chuyển tiền thành công
50,000 VND
Người chuyển
VÕ THANH HẰNG
`;

const transferDetail = `
MSB
50,000 VND
Đến tài khoản
LE MINH TRUNG
Techcombank 6687736868
Từ tài khoản
LY THANH HIEN
MSB 80003878143
Nội dung
80003878143-Ref 6254MCOBQ2MD19CS-CK 24/7
Kênh giao dịch
MSB Digibank
Mã giao dịch
FT262549CQRB
`;

const noisyReferral = supplement.replace("CIUSTSF-5", "YPHPDVC-5 | ` THE");
const blankReferral = supplement.replace("CIUSTSF-5\n", "");

assert.deepEqual(parseMsbOpenSuccess(open), {
  success: true,
  customerName: "VO THANH HANG",
  accountNumber: "80003855100",
  missing: [],
});
assert.equal(parseMsbOpenSuccess(photographedOpen).customerName, "PHAN VAN PHUC");
assert.deepEqual(parseMsbSupplement(supplement), {
  supplement: true,
  branch: "PGD Thuận An",
  referralCode: "CIUSTSF-5",
  missing: [],
});
assert.equal(parseMsbSupplement(noisyReferral).referralCode, "YPHPDVC-5");
assert.equal(parseMsbSupplement(blankReferral).referralCode, "");
assert.deepEqual(parseMsbTransfer(transfer), {
  bank: true,
  kind: "success",
  success: true,
  transactionCode: "",
  missing: [],
});
assert.deepEqual(parseMsbTransfer(transferDetail), {
  bank: true,
  kind: "detail",
  success: true,
  transactionCode: "FT262549CQRB",
  missing: [],
});
assert.equal(parseMsbTransfer("MSB\nKích hoạt thẻ thành công").success, false);
assert.equal(
  parseMsbTransfer("MSB\nĐến tài khoản\nTừ tài khoản\nKênh giao dịch").success,
  false,
);

const context = {
  referralCode: "CIUSTSF-5 - MCT: TIKTOK",
  referralName: "CIUSTSF-5",
  supportBranch: "PGD THUẬN AN",
  customerName: "VO THANH HANG",
  accountNumber: "0354257408",
};
assert.deepEqual(
  checkMsb([open, supplement, transfer], context).map((item) => item.verdict),
  ["pass", "pass", "pass"],
);
assert.equal(
  checkMsb([open.replace("VÕ THANH HẰNG", "NGUYỄN VĂN AN"), supplement, transfer], context)[0]
    .verdict,
  "fail",
);
assert.equal(
  checkMsb(
    [open, supplement.replace("PGD Thuận An", "PGD Đồng Tháp"), transfer],
    context,
  )[1].verdict,
  "fail",
);
assert.deepEqual(
  checkMsb(
    [open, supplement.replace("CIUSTSF-5", "ACT22"), transfer],
    context,
  )[1].issues,
  ["Mã giới thiệu không khớp"],
);
assert.equal(
  checkMsb(
    [open, supplement.replace("CIUSTSF-5", "ACT22"), transfer],
    context,
  )[1].verdict,
  "fail",
);

// Kết quả JSON cũ chưa có `issues` vẫn phải hiện lỗi nghiệp vụ, không hiện
// tên nhóm ảnh như “Màn hình chính” hay “Thông tin trong app”.
assert.deepEqual(
  photoCheckIssueLabels({
    key: "home",
    verdict: "fail",
    found: "DUONG THI MONG GIAO - 10005476705",
    expected: "PHUONG THI MONG GIAO - 10005475705",
    note: "Tên trên ảnh DUONG THI MONG GIAO, tên khách PHUONG THI MONG GIAO. Số tài khoản trên ảnh 10005476705, đã nhập 10005475705.",
  }),
  ["Tên khách hàng không khớp", "Số tài khoản không khớp"],
);
assert.equal(
  checkMsb([open, supplement, transfer], {
    ...context,
    supportBranch: "PGD: Tự chọn",
  })[1].verdict,
  "pass",
);
assert.equal(
  checkMsb(
    [open, supplement.replace("CIUSTSF-5", "MGST2026"), transfer],
    {
      ...context,
      referralCode: "MGST2026 - MCT: trống",
      referralName: "MGST2026 (phòng 10)",
      supportBranch: "PGD: Tự chọn",
    },
  )[1].verdict,
  "pass",
);
// Hai mã thật lệch ký tự đầu không được coi là cùng mã.
assert.equal(
  checkMsb(
    [open, supplement.replace("CIUSTSF-5", "APHPDVC-5"), transfer],
    { ...context, referralName: "YPHPDVC-5", referralCode: "YPHPDVC-5 - MCT: CTV1" },
  )[1].verdict,
  "fail",
);

console.log("MSB photo parser: OK");
