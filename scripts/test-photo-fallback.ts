import assert from "node:assert/strict";
import { checkMb } from "../src/server/ocr/banks/mb";
import { checkLpb } from "../src/server/ocr/banks/lpb";
import { checkMsb } from "../src/server/ocr/banks/msb";
import { checkTpbank } from "../src/server/ocr/banks/tpbank";
import { adaptPaddleText, fallbackPhotoIndexes } from "../src/server/ocr/fallback";
import type { CheckedItem } from "../src/server/ocr/types";

const context = {
  referralCode: "",
  referralName: "E640-PGD Cai Lậy",
  province: "Đồng Tháp",
  supportBranch: "PGD Cai Lậy",
  customerName: "PHAM THI A",
  accountNumber: "0797521649",
  openedDate: "2026-09-11",
};
const registration = "Đăng ký tài khoản\nMã người giới thiệu (Mã RM)\nE640\nChọn Tỉnh/Thành phố\nĐồng Tháp\nChọn chi nhánh hỗ trợ\nPGD Coi";
const profile = "Hồ sơ người dùng\nPHAM THI A\nUser ID: 0797521649";
const transfer = "Truy vấn giao dịch\nTIỀN RA -100,000 VND";
const texts = [profile, transfer, registration];
const initial = checkMb(texts, context);
assert.deepEqual(initial.map((item) => item.verdict), ["fail", "pass", "pass"]);
// Bộ nhãn phải trả về ĐÚNG ảnh đã dùng, không chỉ kết luận.
assert.deepEqual(initial.map((item) => item.photoIndex), [2, 0, 1]);
assert.deepEqual(fallbackPhotoIndexes(initial, texts.length), [2]);

// Lỗi "không khớp" VẪN đọc lại: Tesseract đọc rõ vẫn đọc sai được, đo
// 2026-09-13 có `EE40` đọc lại thành `E640`.
const clearMismatch = registration.replace("E640", "Q694").replace("PGD Coi", "PGD Cai Lậy");
assert.deepEqual(
  fallbackPhotoIndexes(checkMb([clearMismatch, profile, transfer], context), 3),
  [0],
);
const good = registration.replace("PGD Coi", "PGD Cai Lậy");
assert.deepEqual(fallbackPhotoIndexes(checkMb([good, profile, transfer], context), 3), []);

/* ── Chọn ảnh: mọi ảnh của mục không đạt ──────────────────────────────── */

const item = (
  key: CheckedItem["key"],
  verdict: CheckedItem["verdict"],
  photoIndex?: number,
): CheckedItem => ({
  key,
  verdict,
  issues: verdict === "pass" ? [] : [verdict === "missing" ? "Thiếu ảnh" : "Không đọc được mã giới thiệu"],
  found: "",
  expected: "",
  note: "",
  photoIndex,
});

// Mục `fail` giữ đúng ảnh của nó và xếp trước; mục `missing` lấy mọi ảnh chưa
// mục nào nhận ra. Ảnh 1 đã phục vụ mục ĐẠT nên bỏ qua.
assert.deepEqual(
  fallbackPhotoIndexes([item("open", "fail", 0), item("home", "pass", 1), item("transfer", "missing")], 5),
  [0, 2, 3, 4],
);

// Mọi ảnh đều phục vụ mục đạt thì mục thiếu không còn ảnh nào để đọc lại.
assert.deepEqual(
  fallbackPhotoIndexes([item("open", "pass", 0), item("home", "pass", 1), item("transfer", "missing")], 2),
  [],
);

// Mục đã đạt hết thì không gọi Paddle.
assert.deepEqual(fallbackPhotoIndexes([item("open", "pass", 0)], 3), []);

// Trần 8 ảnh chặn tài khoản nộp thừa ảnh chiếm hàng đợi Paddle.
assert.equal(fallbackPhotoIndexes([item("open", "missing")], 20).length, 8);

/* ── Bộ nhãn từng ngân hàng phải gắn được số thứ tự ảnh ───────────────── */

const lpbUnreadable = "Thông tin tài khoản\nChủ tài khoản PHAM THI A\nNgày mở tài khoản";
assert.deepEqual(fallbackPhotoIndexes(checkLpb([lpbUnreadable], context), 1), [0]);
const msbUnreadable = "2.3 Bổ sung thông tin\nChi nhánh/PGD\nPGD Cai Lậy\nMã giới thiệu";
assert.deepEqual(fallbackPhotoIndexes(checkMsb([msbUnreadable], context), 1), [0]);
const tpbUnreadable = "Xin chào\n1000 1234 567 079 752 1649";
const tpbContext = { ...context, accountNumber: "10001234567" };
assert.deepEqual(fallbackPhotoIndexes(checkTpbank([tpbUnreadable], tpbContext), 1), [0]);

/* ── Chuyển nhãn Paddle về dạng bộ nhãn chờ ───────────────────────────── */

const adapted = adaptPaddleText("MB", [
  "Đăng ký tài khon", "Mã ngưi gii thiu (Mã RM)", "E640",
  "Chon Tnh/Thành ph", "Đồng Tháp", "Chn chi nhánh h tr", "PGD Cai Lây",
]);
assert.equal(checkMb([adapted, profile, transfer], context)[0].verdict, "pass");
assert.ok(adapted.includes("PGD Cai Lây"));

const lpbLines = adaptPaddleText("LPB", [
  "Thông tin tài khoản", "Chủ tài khoản", "NGUYENHUUTHOAI",
  "Ngày m tài khon", "11/09/2026",
]);
assert.ok(lpbLines.includes("Chủ tài khoản NGUYENHUUTHOAI"));
assert.ok(lpbLines.includes("Ngày mở tài khoản: 11/09/2026"));
// Nhãn và giá trị chung một dòng: lớp chuyển nhãn không được làm rơi dữ liệu.
assert.equal(adaptPaddleText("LPB", ["Ngày mở tài khoản: 11/09/2026"]), "Ngày mở tài khoản: 11/09/2026");
assert.equal(adaptPaddleText("MSBa", ["Chi nhánh/PGD LH Thăng Long"]), "Chi nhánh/PGD LH Thăng Long");
assert.equal(adaptPaddleText("MSBb", ["Mã giới thiệu APHPDVC-5"]), "Mã giới thiệu APHPDVC-5");
assert.equal(adaptPaddleText("TPB", ["Xin chào NGUYEN VAN A"]), "Xin chào NGUYEN VAN A");

console.log("Photo OCR fallback: OK");
