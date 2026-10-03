import assert from "node:assert/strict";
import { bidvFacts, checkBidv } from "../src/server/ocr/banks/bidv";
import { checkMbv, mbvFacts } from "../src/server/ocr/banks/mbv";
import { checkShb, shbFacts } from "../src/server/ocr/banks/shb";
import { checkTcb, tcbFacts } from "../src/server/ocr/banks/tcb";
import { checkVib, vibFacts } from "../src/server/ocr/banks/vib";

/**
 * Chữ mẫu là chữ VietOCR đọc từ ảnh thật, đo 2026-10-03 (2 tài khoản mỗi ngân
 * hàng, TCB 1). Chạy: `bun scripts/test-bidv-mbv-shb-tcb-vib-photo-parser.ts`.
 */
const text = (...lines: string[]) => lines.join("\n");

/* ── BIDV ─────────────────────────────────────────────────────────────── */

const bidv = { referralCode: "162711", customerName: "Lê Thị Ngọt" };
const bidvStep3 = text("Khai báo thông tin", "Bước 3/4", "?Chi nhánh mở tài khoản", "CN Tây Đô", "Mã cán bộ giới thiệu", "162711", "Mã giới thiệu");
const bidvDetail = text("Chi tiết tài khoản", "8930352477", "Lịch sử giao dịch", "OVND", "Le Thi Ngot", "Tên chủ tài khoản", "Số dư", "OVND");
const bidvHistory = text("Bộ lọc", "Toàn bộ GD tại BIDV", "Tìm kiếm", "Tiền ra", "Hôm nay 28/09/2026", "MB-TKThe 325148911", "-100,000 VND", "4100,000 VND");
assert.equal(bidvFacts(bidvStep3, bidv).codeFound, true);
assert.equal(bidvFacts(bidvDetail, bidv).nameFound, true);
assert.equal(bidvFacts(bidvDetail, bidv).successFound, false, "màn chi tiết tài khoản 0 VND không phải giao dịch");
assert.equal(bidvFacts(bidvHistory, bidv).successFound, true);
assert.deepEqual(checkBidv([bidvStep3, bidvDetail, bidvHistory], bidv).map((i) => i.verdict), ["pass", "pass", "pass"]);
assert.equal(checkBidv([bidvDetail], bidv)[1].label, "Tên khách hàng", "BIDV không so số tài khoản");

/* ── MBV ──────────────────────────────────────────────────────────────── */

const mbv = { referralCode: "A101", customerName: "Huỳnh Văn Ngọc", accountNumber: "0984926050" };
const mbvConfirm = text("Xác nhận thông tin", "Số tài khoản", "0984 9260 50", "Thông tin người giới thiệu", "HOANG THI HUONG", "A101 - MBV CHI LINH");
const mbvRegistered = text("Đăng ký thành công", "Số tài khoản", "0984 9260 50", "HUYNH VAN NGOC", "Tên tài khoản");
const mbvTransfer = text("MBV?", "Giao dịch thành công", "x", "100,000 VND", "Đến tài khoản", "LY DANG QUANG");
assert.equal(mbvFacts(mbvConfirm, mbv).codeFound, true);
assert.equal(mbvFacts(mbvConfirm, { ...mbv, referralCode: "A10" }).codeFound, false, "A10 không phải A101");
assert.equal(mbvFacts(mbvConfirm, { ...mbv, referralCode: "MGT: A101" }).codeFound, false, "Mã text kèm chú thích là lỗi nhập liệu");
assert.equal(mbvFacts(mbvRegistered, mbv).accountFound, true);
assert.equal(mbvFacts(mbvRegistered, mbv).successFound, false, "Đăng ký thành công không phải giao dịch");
assert.deepEqual(checkMbv([mbvConfirm, mbvRegistered, mbvTransfer], mbv).map((i) => i.verdict), ["pass", "pass", "pass"]);

/* ── SHB ──────────────────────────────────────────────────────────────── */

const shb = { referralCode: "TT2468", customerName: "Nguyễn Thị Dung", accountNumber: "0377046597" };
const shbForm = text("Bước 1: Tải app SHB SAHA và chọn Đăng ký", "NGUYỄN THỊ DUNG", "0377046597", "TT2468", "Tải ứng dụng SHB SAHA");
const shbOpened = text("Mở tài khoản thành công", "Số tài khoản", "000377046597", "Tên tài khoản", "Nguyen Thi Dung", "- Tên đăng nhập: 0377046597");
const shbTransfer = text("SSHBS3", "Giao dịch thành công", "50,000 VND", "Tài khoản nguồn", "Nguyen Thi Dung");
assert.equal(shbFacts(shbForm, shb).codeFound, true);
assert.equal(shbFacts(shbOpened, shb).accountFound, true, "Tên đăng nhập in đúng số điện thoại");
assert.equal(shbFacts(shbOpened, shb).successFound, false, "Mở tài khoản thành công không phải giao dịch");
assert.deepEqual(checkShb([shbForm, shbOpened, shbTransfer], shb).map((i) => i.verdict), ["pass", "pass", "pass"]);

/* ── VIB ──────────────────────────────────────────────────────────────── */

const vib = { referralCode: "RSR", customerName: "Huỳnh Thanh Nga", accountNumber: "0396104652" };
const vibOpen = text("Xác nhận", "Mở tài khoản thanh toán Digi", "Huỳnh Thanh Nga", "Chủ tài khoản", "Số tài khoản", "396104652", "Tên đăng nhập", "0396104652", "RSR", "Mã giới thiệu");
const vibTransfer = text("Hóa đơn", "Chuyển tiên thành công", "50,000 d", "Số tiền", "Huỳnh THANH NGA chuyen tien");
assert.equal(vibFacts(vibOpen, vib).codeFound, true);
assert.equal(vibFacts(vibOpen, { ...vib, referralCode: "RS" }).codeFound, false);
assert.equal(vibFacts(vibOpen, vib).accountFound, true);
assert.equal(vibFacts(vibTransfer, vib).successFound, true, "OCR đọc tiền thành tiên");
assert.deepEqual(checkVib([vibOpen, vibTransfer], vib).map((i) => i.verdict), ["pass", "pass", "pass"]);

/* ── TCB ──────────────────────────────────────────────────────────────── */

const tcb = { referralCode: "", customerName: "LE THANH HOANG" };
const tcbTransfer = text("TECHCOMBANK", "Chuyển thành công", "TỚI NGUYEN NGHIA BINH", "VND 100,000", "LE THANH HOANG chuyen tien");
const tcbOpened = text("Mở tài khoản thành công[", "19077100854019", "Số tài khoản", "LÊ THANH HOÀNG", "Chủ tài khoản");
assert.equal(tcbFacts(tcbTransfer, tcb).successFound, true);
assert.equal(tcbFacts(tcbOpened, tcb).successFound, false);
const tcbItems = checkTcb([tcbTransfer, tcbOpened], tcb);
assert.deepEqual(tcbItems.map((i) => i.verdict), ["pass", "pass", "pass"]);
assert.equal(tcbItems[0].note, "Mã đã chọn không có mã chữ, không so được.", "Mã text trống thì không so");

console.log("BIDV, MBV, SHB, TCB, VIB: mọi ca đạt.");
