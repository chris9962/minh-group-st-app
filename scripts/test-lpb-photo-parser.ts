import assert from "node:assert/strict";
import {
  checkLpb,
  parseLpbAccountInfo,
  parseLpbReferral,
  parseLpbTransfer,
} from "../src/server/ocr/banks/lpb";

/* ── Mẫu OCR, rút gọn từ 12 tài khoản LPBank hoàn thành local 2026-09-12 ── */

const accountInfo = `
14:38 t 1 thiết bị
Thông tin tài khoản x
C3 Tài khoản thanh toán
0942854815
Chủ tài khoản SON THI NGOC SANG
Ngày mở tài khoản: 08/09/2026
Chi nhánh PGD LONG PHU
Số dư hiện tại OVND
Số dư khả dụng OVND
`;

// OCR đọc "mở" thành "mồ", chèn dấu chấm/phẩy rác quanh nhãn — đo thật.
const accountInfoNoisy = `
Thông tin tài khoản x
C3. Tàikhoảnthanhtoán
0584609224
Chủ tải khoản, NGUYEN THITIENI>
Ngày mồ tài khoản. 07/09/2026.
Chinhánh PGDTRANOC
Số dư hiện tại OVND
`;

const referralTab = `
Giới thiệu bạn bè
Mã giới thiệu: 0942854815
Chia sẻ mã giới thiệu
Danh sách giới thiệu Xem tất cả
Người giới thiệu của tôi
Mã giới thiệu 0777706075
LƯƠNG THỊ NGỌC ANH
`;

const registerStep = `
Đăng ký dịch vụ
Vui lòng nhập thông tin bên dưới
Số điện thoại
0942854815 x
Thông tin người giới thiệu (nếu có)
0777706075 x
LƯƠNG THỊ NGỌC ANH
Tiếp tục
`;

const transferSuccess = `
LPBank
Chuyển tiền thành công
100,000
Một trăm nghìn Việt Nam đồng
Tới tài khoản
TRAN THI THU HA
Techcombank 0944778580
Thời gian
08/09/2026 - 14:58:08
Nội dung
DUONG THI UT chuyen tien
Xem thêm
`;

const balanceNotification = `
Biến động số dư.
Số tiền GD: -100,000 VND
Tài khoản: 0942854815 10:26
`;

// Màn "Mã QR của tôi" — không thuộc phép kiểm nào, dùng để thử không bị nhận nhầm.
const qrScreen = `
Mã QR của tôi
LPBank
Quét mã để chuyển tiền đến
SON THI NGOC SANG
0942854815
Chia sẻ Tải về
`;

// Phiếu ghi tay (Ảnh "phiếu thông tin") — có cụm "Thông tin tài khoản" nhưng
// KHÔNG có nhãn "Chủ tài khoản" / "Ngày mở tài khoản" của app.
const handwrittenSlip = `
NGÂN HÀNG..........
Thông tin tài khoản: ..........
Số tài khoản:..........
Mật khẩu:..........
Mã Pin:..........
`;

// Chữ số cuối năm "2026" bị Tesseract đọc thành chữ cái ở CẢ BA lượt đọc — đo
// thật trên tài khoản NGUYEN THI LUA 2026-09-12, `202é` sau khi bỏ dấu còn `202e`.
const accountInfoYearGarbled = accountInfo.replace("08/09/2026", "08/09/202e");

// Ngày "11" (hai chữ số 1 đứng liền) bị Tesseract đọc hỏng gần như luôn luôn —
// đo cả lô tài khoản mở ngày 2026-09-11: "11/09/2026" đọc thành "1/09/2026"
// (rớt một số) hoặc "TI/09/2026" (đọc thành chữ).
const accountInfoDayGarbledMissingDigit = accountInfo
  .replace("08/09/2026", "1/09/2026")
  .replace("SON THI NGOC SANG", "LY THANH LONG");
const accountInfoDayGarbledAsLetters = accountInfo
  .replace("08/09/2026", "TI/09/2026")
  .replace("SON THI NGOC SANG", "LY THANH LONG");

// Số điện thoại người giới thiệu bị Tesseract đọc dư một số — cùng lỗi đo
// thật trên tài khoản THACH THI PHUONG 2026-09-12: "0916383757" đọc dư một số
// thành "09165835757", tên vẫn đọc đúng.
const referralPhoneGarbled = referralTab.replace("0777706075", "07777060755");

// Tên người giới thiệu viết Hoa Chữ Đầu Mỗi Từ thay vì IN HOA — đo thật trên
// tài khoản THACH THI PHUONG 2026-09-12, dòng tên hiện "Trần Thị Vân Anh".
const referralNameTitleCase = referralTab.replace("LƯƠNG THỊ NGỌC ANH", "Lương Thị Ngọc Anh");

// Tên khách trên màn "Thông tin tài khoản" cũng có thể viết Hoa Chữ Đầu Mỗi
// Từ — nhãn "Chủ tài khoản" đứng ngay trước phải bị bỏ trước khi tách, không
// thì chữ "Chủ" lẫn vào tên vì cùng kiểu viết hoa.
const accountInfoNameTitleCase = accountInfo.replace("SON THI NGOC SANG", "Son Thi Ngoc Sang");

/* ── parseLpbAccountInfo ───────────────────────────────────────────────── */

assert.deepEqual(parseLpbAccountInfo(accountInfo), {
  customerName: "SON THI NGOC SANG",
  accountNumber: "0942854815",
  openedDate: "2026-09-08",
  openedDateLoose: "2026-09-08",
  missing: [],
});
assert.equal(parseLpbAccountInfo(accountInfoNoisy).customerName, "NGUYEN THITIENI");
assert.equal(parseLpbAccountInfo(accountInfoNoisy).openedDate, "2026-09-07");
assert.deepEqual(parseLpbAccountInfo(handwrittenSlip).missing, ["customerName", "openedDate"]);
assert.deepEqual(parseLpbAccountInfo(qrScreen).missing, ["customerName", "openedDate"]);

// Ngày mở đọc lỗi ở đúng một số cuối của năm vẫn nhận ra được, ở dạng lỏng.
assert.equal(parseLpbAccountInfo(accountInfoYearGarbled).openedDate, "");
assert.equal(parseLpbAccountInfo(accountInfoYearGarbled).openedDateLoose, "202?-09-08");
assert.deepEqual(parseLpbAccountInfo(accountInfoYearGarbled).missing, []);

// Tên khách viết Hoa Chữ Đầu Mỗi Từ vẫn đọc ra được, KHÔNG dính chữ "Chu" của nhãn.
assert.equal(parseLpbAccountInfo(accountInfoNameTitleCase).customerName, "Son Thi Ngoc Sang");

// Ngày "11" đọc rớt một số hoặc đọc thành chữ vẫn nhận ra được, ở dạng lỏng
// với CẢ NGÀY là dấu hỏi vì không đoán được chính xác ngày thật.
assert.equal(parseLpbAccountInfo(accountInfoDayGarbledMissingDigit).openedDate, "");
assert.equal(parseLpbAccountInfo(accountInfoDayGarbledMissingDigit).openedDateLoose, "2026-09-??");
assert.equal(parseLpbAccountInfo(accountInfoDayGarbledAsLetters).openedDate, "");
assert.equal(parseLpbAccountInfo(accountInfoDayGarbledAsLetters).openedDateLoose, "2026-09-??");

/* ── parseLpbReferral ─────────────────────────────────────────────────── */

assert.deepEqual(parseLpbReferral(referralTab), {
  recognized: true,
  referralCode: "0777706075",
  referralName: "LUONG THI NGOC ANH",
  missing: [],
});
assert.deepEqual(parseLpbReferral(registerStep), {
  recognized: true,
  referralCode: "0777706075",
  referralName: "LUONG THI NGOC ANH",
  missing: [],
});
assert.deepEqual(parseLpbReferral(qrScreen), {
  recognized: false,
  referralCode: "",
  referralName: "",
  missing: ["recognized", "referralCode"],
});
// Số điện thoại 11 số (dư một số) vẫn đọc ra được — phần so khớp mới quyết định đủ gần hay không.
assert.equal(parseLpbReferral(referralPhoneGarbled).referralCode, "07777060755");
// Tên người giới thiệu viết Hoa Chữ Đầu Mỗi Từ vẫn đọc ra được.
assert.equal(parseLpbReferral(referralNameTitleCase).referralName, "Luong Thi Ngoc Anh");

/* ── parseLpbTransfer ─────────────────────────────────────────────────── */

assert.equal(parseLpbTransfer(transferSuccess).success, true);
assert.equal(parseLpbTransfer(balanceNotification).success, true);
assert.equal(parseLpbTransfer(qrScreen).success, false);
assert.equal(parseLpbTransfer(handwrittenSlip).success, false);

/* ── checkLpb ─────────────────────────────────────────────────────────── */

const context = {
  referralCode: "0777706075",
  referralName: "LƯƠNG THỊ NGỌC ANH",
  customerName: "SON THI NGOC SANG",
  openedDate: "2026-09-08",
};
const photos = [accountInfo, referralTab, transferSuccess, qrScreen];

assert.deepEqual(
  checkLpb(photos, context).map((item) => item.verdict),
  ["pass", "pass", "pass"],
);

// Thiếu ảnh giới thiệu bạn bè.
assert.deepEqual(
  checkLpb([accountInfo, transferSuccess], context).find((i) => i.key === "open"),
  {
    key: "open",
    verdict: "missing",
    label: "Mã giới thiệu",
    issues: ["Thiếu ảnh xác thực mã giới thiệu"],
    found: "",
    expected: "0777706075",
    note: "Không ảnh nào là màn giới thiệu bạn bè hoặc bước nhập mã giới thiệu.",
  },
);

// Mã giới thiệu trên ảnh khác mã đã chọn — không nới lỏng thành khớp.
const wrongReferral = referralTab
  .replace("0777706075", "0904936986")
  .replace("LƯƠNG THỊ NGỌC ANH", "TRAN THI ANH TUYET");
assert.equal(
  checkLpb([accountInfo, wrongReferral, transferSuccess], context).find((i) => i.key === "open")?.verdict,
  "fail",
);
assert.deepEqual(
  checkLpb([accountInfo, wrongReferral, transferSuccess], context).find((i) => i.key === "open")?.issues,
  ["Mã giới thiệu không khớp"],
);

// Tên khách trên ảnh khác tên hệ thống.
const wrongName = accountInfo.replace("SON THI NGOC SANG", "NGUYEN VAN KHAC");
assert.equal(
  checkLpb([wrongName, referralTab, transferSuccess], context).find((i) => i.key === "home")?.verdict,
  "fail",
);
assert.deepEqual(
  checkLpb([wrongName, referralTab, transferSuccess], context).find((i) => i.key === "home")?.issues,
  ["Tên khách hàng không khớp"],
);

// Ngày mở trên ảnh khác ngày hệ thống ghi.
const wrongDate = accountInfo.replace("08/09/2026", "01/09/2026");
assert.deepEqual(
  checkLpb([wrongDate, referralTab, transferSuccess], context).find((i) => i.key === "home")?.issues,
  ["Ngày mở tài khoản không khớp"],
);

// Thiếu ảnh giao dịch.
assert.equal(
  checkLpb([accountInfo, referralTab], context).find((i) => i.key === "transfer")?.verdict,
  "missing",
);

// Mã giới thiệu đọc dư một số nhưng tên người giới thiệu khớp — chấp nhận,
// vì hai người giới thiệu khác nhau trùng cả tên lẫn số gần giống nhau không
// xảy ra trong thực tế.
assert.equal(
  checkLpb([accountInfo, referralPhoneGarbled, transferSuccess], context).find((i) => i.key === "open")?.verdict,
  "pass",
);

// Ngày mở đọc lỗi đúng một số cuối của năm — chấp nhận nhờ so khớp lỏng.
assert.equal(
  checkLpb([accountInfoYearGarbled, referralTab, transferSuccess], context).find((i) => i.key === "home")?.verdict,
  "pass",
);

// Mã giới thiệu đọc dư một số, tên người giới thiệu đọc ra dạng Hoa Chữ Đầu
// Mỗi Từ — vẫn phải chấp nhận nhờ tên khớp, không phụ vào kiểu viết hoa.
const referralPhoneAndNameTitleCase = referralNameTitleCase.replace("0777706075", "07777060755");
assert.equal(
  checkLpb([accountInfo, referralPhoneAndNameTitleCase, transferSuccess], context).find((i) => i.key === "open")
    ?.verdict,
  "pass",
);

// Mã giới thiệu sai VÀ tên người giới thiệu cũng sai — không có gì corroborate, vẫn phải fail.
const wrongReferralNoName = referralTab
  .replace("0777706075", "07777060755")
  .replace("LƯƠNG THỊ NGỌC ANH", "TRAN THI ANH TUYET");
assert.equal(
  checkLpb([accountInfo, wrongReferralNoName, transferSuccess], context).find((i) => i.key === "open")?.verdict,
  "fail",
);

// Ảnh chụp nhầm của khách khác lẫn trong bộ, vẫn còn ảnh đúng thì ưu tiên ảnh khớp.
const otherCustomer = accountInfo
  .replace("SON THI NGOC SANG", "NGUOI KHAC HAN")
  .replace("08/09/2026", "01/09/2026");
assert.equal(
  checkLpb([otherCustomer, accountInfo, referralTab, transferSuccess], context).find((i) => i.key === "home")
    ?.verdict,
  "pass",
);

console.log("LPB photo parser: OK");
