import assert from "node:assert/strict";
import { checkMb, mbFacts, mbReferral } from "../src/server/ocr/banks/mb";

/**
 * Chữ mẫu lấy từ chữ VietOCR đọc ảnh thật trong bộ đo 2026-09-22 (40 tài
 * khoản MB), mỗi dòng một vùng chữ. Chạy: `bun scripts/test-mb-photo-parser.ts`.
 */

const registration = `
Đăng ký tài khoản
Nhập số điện thoại
0812012238
Nghề nghiệp
Khác
Thông tin cá nhân
Mã người giới thiệu (Mã RM)
5168
Họ và tên
THAI TIEN PHO
Chi nhánh chăm sóc khách hàng
Chọn Tỉnh/Thành phố
An Giang
Chọn chi nhánh hỗ trợ
CN An Giang
Số 128-130 đường Nguyễn Trãi, phường Long Xuyên,
`;

const profile = `
Hồ sơ người dùng
LE THI CHAU
User ID: 0812012238
Tăng cường
bảo vệ
Gói hội viên MB
Basic
`;

const history = `
Chi tiết tài khoản
Truy vấn giao dịch
Từ ngày
04/09/2026
Truy vấn
10/09/2026
TIỀN RA
-100,000 VND
CUSTOMERLE THI CHAU chuyen tien
08:34
TIỀN VÀO
+200,000 VND
`;

/** Màn huỷ thiết bị có dấu tick nhưng không phải giao dịch. */
const unlinkDevice = `
Đã huỷ liên kết thiết bị
Những thiết bị dưới đây đã hủy liên kết
DANH SÁCH THIẾT BỊ
Thiết bị 1
REDMI Note 15-100926
Về trang Đăng nhập
`;

const ctx = {
  referralCode: "",
  referralName: "5168-Tiến Phò-CN An Giang",
  province: "An Giang",
  supportBranch: "CN An Giang",
  customerName: "Lê Thị Châu",
  accountNumber: "0812012238",
};

assert.equal(mbReferral(ctx), "5168");
assert.equal(mbReferral({ referralCode: "", referralName: "o826 chữ O -Thị Ước-CN Tiền Giang-Đồng Tháp" }), "O826");
assert.equal(mbReferral({ referralCode: "", referralName: "BL59-Phan Mỹ Đình- CN Sóc Trăng-Cần Thơ" }), "BL59");

assert.deepEqual(mbFacts(registration, ctx), {
  nameFound: false,
  accountFound: true,
  codeFound: true,
  successFound: false,
  provinceFound: true,
  branchFound: true,
});
assert.deepEqual(mbFacts(profile, ctx), {
  nameFound: true,
  accountFound: true,
  codeFound: false,
  successFound: false,
  provinceFound: false,
  branchFound: false,
});
assert.equal(mbFacts(history, ctx).successFound, true);
assert.equal(mbFacts(history, ctx).nameFound, true, "tên dính nhãn CUSTOMER rồi nối chuyen tien");
assert.equal(mbFacts(unlinkDevice, ctx).successFound, false);
assert.equal(mbFacts("Hạn mức chuyển tiền ra ngoài hệ thống\n50,000,000 VND", ctx).successFound, false, "TIỀN RA phải là hai từ riêng");

assert.equal(mbFacts(registration, { ...ctx, referralName: "5186-…" }).codeFound, false);
assert.equal(mbFacts(registration, { ...ctx, province: "Đồng Tháp" }).provinceFound, false);
assert.equal(mbFacts(registration, { ...ctx, supportBranch: "Chi nhánh An Giang" }).branchFound, true, "Chi nhánh = CN");
assert.equal(mbFacts(registration, { ...ctx, supportBranch: "PGD Châu Phú" }).branchFound, false);
assert.equal("provinceFound" in mbFacts(registration, { ...ctx, province: "" }), false, "mã chưa cấu hình tỉnh thì không so");
assert.equal("branchFound" in mbFacts(registration, { ...ctx, supportBranch: "Tự chọn" }), false);

/** Chữ VietOCR ảnh thật 2026-09-25, mã AZ96: app in tên chi nhánh không có "CN". */
const bareBranch = (branch: string) => `Chọn Tỉnh/Thành phố\nHà Nội\nChọn chi nhánh hỗ trợ\n10\n${branch}`;
const hanoi = { ...ctx, province: "Hà Nội", supportBranch: "CN Mê Linh" };
assert.equal(mbFacts(bareBranch("Mê Linh"), hanoi).branchFound, true, "app in trần Mê Linh");
assert.equal(mbFacts(bareBranch("CN Mê Linh"), hanoi).branchFound, true);
assert.equal(mbFacts(bareBranch("Hoài Đức"), hanoi).branchFound, false);
assert.equal(mbFacts(bareBranch("SMB PGD Đô Lương"), { ...hanoi, supportBranch: "SMB Đô Lương" }).branchFound, true);
assert.equal(mbFacts(bareBranch("Tàn Sơn Nhất"), { ...hanoi, supportBranch: "CN Tân Sơn Nhất" }).branchFound, true, "OCR sai dấu");
assert.equal(
  mbFacts(`Chọn Tỉnh/Thành phố\nAn Giang\nChọn chi nhánh hỗ trợ\nPGD Châu Phú`, ctx).branchFound,
  false,
  "CN An Giang trùng tên tỉnh: dòng tỉnh An Giang không được tính là chi nhánh",
);

/** Chữ VietOCR ảnh thật 2026-09-26: T đọc thành 1, Q thành 0, dãy 9999 thừa một số 9. */
const rm = (code: string) => ({ ...ctx, referralName: `${code}-Anh Tú-CN An Giang` });
assert.equal(mbFacts("Mã người giới thiệu (Mã RM)\n0\n1771", rm("T771")).codeFound, true, "T771 đọc thành 1771");
assert.equal(mbFacts("Mã người giới thiệu (Mã RM)\n0135", rm("Q135")).codeFound, true, "Q135 đọc thành 0135");
assert.equal(mbFacts("Mã người giới thiệu (Mã RM)\n1772", rm("T771")).codeFound, false);
const loan = { ...ctx, accountNumber: "0949999701" };
assert.equal(mbFacts("User ID: 09499999701", loan).accountFound, true, "thừa một số 9");
assert.equal(mbFacts("User ID: 0949999701", loan).accountFound, true);
assert.equal(mbFacts("User ID: 094999701", loan).accountFound, false, "thiếu số 9 là số khác");
assert.equal(mbFacts("User ID: 094999999701", loan).accountFound, false, "thừa hai số 9");
assert.equal(mbFacts("User ID: 0949997701", loan).accountFound, false);
assert.equal(
  mbFacts("CUSTOMERMBCT NGUYEN VAN CUA\nchuyen tien D26 NVCAZ/166094", { ...ctx, customerName: "Nguyễn Văn Của" }).nameFound,
  true,
  "tên và chuyen tien nằm hai dòng",
);

const items = checkMb([registration, profile, history, unlinkDevice], ctx);
assert.deepEqual(
  items.map((i) => [i.key, i.verdict, i.photoIndex]),
  [
    ["open", "pass", 0],
    ["home", "pass", 1],
    ["transfer", "pass", 2],
  ],
);
assert.equal(items[0].label, "Mã giới thiệu, Tỉnh/Thành phố và Chi nhánh hỗ trợ");
assert.equal(items[0].expected, "5168 - An Giang - CN An Giang");

const wrong = checkMb([registration, profile, history], { ...ctx, province: "Cần Thơ", supportBranch: "CN Tây Đô" });
assert.deepEqual(wrong[0].issues, ["Không tìm thấy Tỉnh/Thành phố", "Không tìm thấy Chi nhánh hỗ trợ"]);
assert.equal(wrong[0].note, "Không tìm thấy Tỉnh/Thành phố Cần Thơ trong ảnh. Không tìm thấy Chi nhánh hỗ trợ CN Tây Đô trong ảnh.");
assert.equal(wrong[0].photoIndex, 0, "vẫn trỏ ảnh có mã");

console.log("MB: mọi ca đạt.");
