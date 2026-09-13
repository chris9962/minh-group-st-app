import assert from "node:assert/strict";
import { checkMb, parseMbProfile, parseMbRegistration, parseMbTransfer } from "../src/server/ocr/banks/mb";

const registration = `
< Đăng ký tài khoản
Thông tin cá nhân
Mã người giới thiệu (Mã RM)
X945
Họ và tên NGUYEN KIM THUY
Chi nhánh chăm sóc khách hàng
Chọn Tỉnh/Thành phố
Đồng Tháp
Chọn chi nhánh hỗ trợ
CN Đồng Tháp
Số 204 Đường Nguyễn Huệ
Tiếp tục
`;

const profile = `
< Hồ sơ người dùng
NGUYEN DUY KHANG
User ID: 0979391214
Gói hội viên MB Basic
ĐIỂM LOYALTY
`;

const history = `
< Chi tiết tài khoản
Truy vốn giao dịch
Từ ngày Đến ngày
11/09/2026
TIỀN RA -100,000 VND
NGUYEN DUY KHANG 14:54
APPMB11 NGUYEN DUY KHANG thanh toan
`;

const context = {
  referralCode: "",
  referralName: "X945-Kim Thuỳ-CN Đồng Tháp",
  province: "Đồng Tháp",
  supportBranch: "CN Đồng Tháp",
  customerName: "NGUYEN DUY KHANG",
  accountNumber: "0979391214",
};

assert.deepEqual(parseMbRegistration(registration), {
  registration: true,
  referralCode: "X945",
  province: "Dong Thap",
  branch: "CN Dong Thap",
  missing: [],
});
assert.equal(parseMbProfile(profile).customerName, "NGUYEN DUY KHANG");
assert.equal(parseMbProfile(profile).userId, "0979391214");
assert.equal(parseMbTransfer(history).kind, "history");
assert.deepEqual(checkMb([registration, profile, history], context).map((item) => item.verdict), ["pass", "pass", "pass"]);

const wrongCode = registration.replace("X945", "Q694");
assert.deepEqual(checkMb([wrongCode, profile, history], context)[0].issues, ["Mã giới thiệu không khớp"]);
assert.deepEqual(checkMb([registration.replace("Đồng Tháp\nChọn", "An Giang\nChọn"), profile, history], context)[0].issues, ["Tỉnh/Thành phố không khớp"]);
assert.deepEqual(checkMb([registration.replace("CN Đồng Tháp", "PGD Sa Đéc"), profile, history], context)[0].issues, ["Chi nhánh hỗ trợ không khớp"]);

const wrongProfile = profile.replace("NGUYEN DUY KHANG", "TRAN QUANG TRUNG").replace("0979391214", "0979391215");
assert.deepEqual(checkMb([registration, wrongProfile, history], context)[1].issues, ["Tên khách hàng không khớp", "User ID không khớp số tài khoản"]);
assert.equal(checkMb([registration, profile.replace("User ID: 0979391214", "User ID:"), history], context)[1].verdict, "fail");

// Nhiều ảnh cùng loại: ảnh đúng thắng ảnh chụp nhầm của khách khác.
assert.deepEqual(checkMb([wrongCode, registration, wrongProfile, profile, history], context).map((item) => item.verdict), ["pass", "pass", "pass"]);

assert.equal(parseMbTransfer("MB\nChuyển tiền thành công\n50,000 VND").success, true);
assert.equal(parseMbTransfer("Thông báo biến động số dư\nTK 03xxx043|GD: -130,000VND\n16:45|SD: 0VND|DEN: A").kind, "balance-notice");
assert.equal(parseMbTransfer("MB\nĐã hủy Digital OTP thành công\n16:45").success, false);
assert.equal(parseMbTransfer("MB\nNhập số tiền 50,000 VND\nTiếp tục").success, false);
assert.deepEqual(checkMb([registration, profile], context)[2].issues, ["Thiếu ảnh giao dịch thành công"]);

// Tỉnh chưa ghim trong dữ liệu không thể coi là đã đối chiếu đạt.
assert.deepEqual(checkMb([registration, profile, history], { ...context, province: "" })[0].issues, ["Mã đã ghim chưa cấu hình Tỉnh/Thành phố"]);

console.log("MB photo parser: OK");
