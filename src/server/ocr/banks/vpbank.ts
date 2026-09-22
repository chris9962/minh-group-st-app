import { codeTokens, compact, hasDigits, hasLabel, hasPhrase, letterWords, lineHasName, splitLines, stripAccents } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh VPBank (VPa, VPb; tài khoản cá nhân `none`, `CNKD`, `HKD`), viết
 * 2026-09-22 theo cách của `tpbank.ts`: tìm giá trị hệ thống trong chữ của cả
 * bộ ảnh, không nhận màn, không dung sai, xem `facts.ts`.
 *
 *   1. mã DAO          `referral_codes.code`, 5 chữ số, ô "DAO SALE" ở bước
 *                      chọn chi nhánh của app VPBank NEO; HKD in "Mã DAO" ở
 *                      màn "Thông tin quy mô và chi nhánh mở TK"
 *   2. mã giới thiệu   ô "MÃ GIỚI THIỆU" cùng màn, cố định theo ngân hàng và
 *                      loại tài khoản, xem `programOf`
 *   3. tên khách       màn "Đăng ký thành công" (Họ và tên), màn hình chính
 *                      NEO, lời nhắn "TÊN chuyen tien"; HKD: "Tên công ty",
 *                      màn QR nhận tiền, màn liên kết eTax
 *   4. số tài khoản    = số điện thoại: "Số tài khoản" và "Tên đăng nhập
 *                      VPBankNEO" ở màn Đăng ký thành công, "Normal Account";
 *                      HKD không so: eTax của hộ kinh doanh liên kết số tài
 *                      khoản doanh nghiệp, không phải số điện thoại
 *   5. giao dịch       xem `hasSuccess`; HKD thay bằng màn "QR nhận tiền" hoặc
 *                      "Yêu cầu mở tài khoản đã được khởi tạo thành công"
 *   6. nạp chứng khoán chỉ tài khoản cá nhân, xem `hasSecurities`
 *   7. mục đích        chỉ CNKD: ô "Mục đích sử dụng tài khoản VPBank" chọn
 *                      "Cá nhân kinh doanh"
 *   8. liên kết eTax   CNKD và HKD: màn "Hủy liên kết tài khoản" của eTax
 *                      Mobile ghi ngân hàng VPBank; CNKD phải kèm số tài khoản
 */

export type VpbCheckContext = {
  /** `banks.code`: `VPa` hay `VPb`. */
  bankCode: string;
  /** Mã DAO, 5 chữ số. */
  referralCode: string;
  customerName: string;
  accountNumber: string;
  /** `bank_accounts.account_type`: `none` | `CNKD` | `HKD`. */
  accountType: string;
};

/**
 * Ô "Mã giới thiệu" của VPBank NEO không theo nhân viên. VPa mở app tay và
 * gõ mã công ty theo loại tài khoản (`banks.guide`: "Nhập MGT: MINHAP (bắt
 * buộc)"; bộ đo 2026-09-22 thấy CNKD gõ `MINHCA`, HKD gõ `MINHHKD`). VPb mở
 * bằng QR nên app tự điền số điện thoại người giới thiệu của QR, mỗi loại
 * tài khoản một QR: cá nhân 8/8 mã DAO cùng số, CNKD 25/27; hướng dẫn ghi
 * "MGT giữ nguyên không xoá". Đổi QR thì đổi số ở đây.
 */
const PROGRAM: Record<string, Record<string, string>> = {
  VPa: { none: "MINHAP", CNKD: "MINHCA", HKD: "MINHHKD" },
  VPb: { none: "0948822956", CNKD: "0369835106" },
};

export const programOf = (ctx: Pick<VpbCheckContext, "bankCode" | "accountType">): string =>
  PROGRAM[ctx.bankCode]?.[ctx.accountType] ?? "";

const CNKD_PURPOSE = "Cá nhân kinh doanh";

/**
 * Số tiền: `10 000 đ`, `10.000 d`, `-10.000`, `10,000 VND`, hoặc ảnh chụp
 * lại mất dấu phân cách `10000g` / `10000 d`. Không nhận dãy số trần: số
 * điện thoại 10 số cũng chia hết thành nhóm ba.
 */
const AMOUNT = /(?<!\d)(?:\d{1,3}(?:[ .,]\d{3})+\s*(?:[dđg]|VND)?|\d{4,6}\s*(?:[dđg](?![A-Za-z])|VND))/i;

const amountLine = (lines: string[]): boolean =>
  lines.some((l) => AMOUNT.test(stripAccents(l)));

/**
 * Giao dịch thành công, bốn dạng:
 *
 * - Màn "Chi tiết giao dịch" của NEO in tiêu đề "Thành công" một dòng riêng,
 *   dấu tick và dấu chấm than đọc thành 1-2 ký tự rác ("O Thành công", "Thành
 *   côngl"); "Đăng ký thành công" và "Kích hoạt thành công" cũng có chữ đó nên
 *   chỉ nhận dòng ngắn không có "đăng ký", và phải kèm số tiền.
 * - Chứng từ "Chuyển tiền thành công" / "Giao dịch thành công", có khi tách
 *   hai dòng.
 * - Ảnh cắt mất tiêu đề hay số tiền đọc hỏng (tài khoản 1b694f73, 088d5704):
 *   thân chứng từ vẫn có "Tài khoản nguồn", "Mã tra soát" hay "Chi tiết giao
 *   dịch" kèm số tiền hoặc lời nhắn "chuyen tien" / "TKCK"; màn nhập lệnh
 *   không có các nhãn đó.
 * - Tab "Lịch sử giao dịch" in từng dòng "Transfer -10.000 đ" hay "Chuyển
 *   tiền" / "Thanh toán hóa đơn" kèm tiền; tiêu đề tab đọc lệch ("Lịch sứ
 *   giao điều") nên so có dung sai.
 * - Tab "Thông báo" mục "Biến động số dư": từng dòng "-10.000 đ", "Chuyen tien
 *   sang TKCK …", "Số dư".
 */
function hasSuccess(lines: string[]): boolean {
  const amount = amountLine(lines);
  // "Đăng ký" / "Kích hoạt" có thể nằm ở dòng kề khi bộ dò tách tiêu đề, nên xét cả hai dòng bên.
  const shortSuccess = lines.some((l, i) => {
    const c = compact(l);
    const at = c.indexOf("THANHCONG");
    if (at < 0 || at > 2 || c.length - at - "THANHCONG".length > 2) return false;
    const around = compact(`${lines[i - 1] ?? ""} ${l} ${lines[i + 1] ?? ""}`);
    return !around.includes("DANGKY") && !around.includes("KICHHOAT");
  });
  if (shortSuccess && amount) return true;
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  if (joined.some((l) => hasLabel(l, "CHUYENTIENTHANHCONG") || hasLabel(l, "GIAODICHTHANHCONG"))) return true;
  const receiptBody = ["TAIKHOANNGUON", "MATRASOAT", "CHITIETGIAODICH"].some((p) => hasPhrase(lines, p));
  if (receiptBody && (amount || hasPhrase(lines, "CHUYENTIEN") || hasPhrase(lines, "TKCK"))) return true;
  if (!amount) return false;
  if (lines.some((l) => hasLabel(l, "LICHSUGIAODICH")) && ["TRANSFER", "CHUYENTIEN", "THANHTOAN"].some((p) => hasPhrase(lines, p)))
    return true;
  // Thanh tab đọc thành "Khuyến mại Biến động", chữ "số dư" rớt sang dòng khác.
  return hasPhrase(lines, "BIENDONG") && ["CHUYENTIEN", "TKCK", "SODU"].some((p) => hasPhrase(lines, p));
}

/**
 * Giao dịch nạp tiền vào tài khoản chứng khoán, trên màn có giao dịch: tới
 * VNDIRECT, VPS Securities, VPBankS, hay lời nhắn "Chuyen tien sang TKCK".
 */
const hasSecurities = (lines: string[]): boolean =>
  ["CHUNGKHOAN", "TKCK", "VNDIRECT", "VPSSECURITIES"].some((p) => hasPhrase(lines, p)) ||
  // "VPBankS" phải là token trọn: "VPBank sẽ gửi…", "VPBank Sài Gòn" cũng bắt đầu bằng VPBANKS.
  lines.some((l) => codeTokens(l).includes("VPBANKS"));

/**
 * Token đúng bằng mã, không so chuỗi con và không ghép token kề như
 * `codeTokens`: tên khách `NGUYEN MINH CANH` chứa `MINHCA`, số tiền `60 000`
 * ghép lại thành mã DAO `60000`.
 */
const hasToken = (lines: string[], code: string): boolean =>
  Boolean(code) &&
  lines.some((l) => stripAccents(l).toUpperCase().split(/[^A-Z0-9]+/).includes(code));

/**
 * Màn "Hủy liên kết tài khoản" của eTax Mobile, phần "Thông tin tài khoản" ghi
 * ngân hàng VPBank. Đòi đúng tiêu đề màn đó: NEO cũng có màn "Liên kết ví
 * điện tử" ghi VPBank.
 */
const hasEtaxLink = (lines: string[]): boolean =>
  lines.some((l) => hasLabel(l, "HUYLIENKETTAIKHOAN")) &&
  (hasPhrase(lines, "VPBANK") || hasPhrase(lines, "THINHVUONG"));

/**
 * Màn "QR nhận tiền" của NEO hay ảnh chụp bảng QR "QR ĐA NĂNG - THANH TOÁN
 * MỌI ỨNG DỤNG" dán ở quầy; hộ kinh doanh nộp thay giao dịch. Ảnh chụp bảng
 * đọc "GR DANĂNG" nên so có dung sai; bảng chụp xa chỉ còn đọc được dòng
 * "VietQR - VPBank" và tên, nhận khi ảnh có ít dòng chữ (không phải màn app).
 */
const hasReceiveQr = (lines: string[]): boolean =>
  hasPhrase(lines, "QRNHANTIEN") ||
  lines.some((l) => hasLabel(l, "QRDANANG") || hasLabel(l, "THANHTOANMOIUNGDUNG")) ||
  (lines.some((l) => hasLabel(l, "VIETQRVPBANK")) && lines.length <= 12);

/** Màn "Yêu cầu mở tài khoản đã được khởi tạo thành công" sau khi nộp hồ sơ hộ kinh doanh. */
const hasOpenRequest = (lines: string[]): boolean =>
  lines.some((l) => hasLabel(l, "YEUCAUMOTAIKHOAN")) && hasPhrase(lines, "KHOITAO");

export function vpbFacts(ocrText: string, ctx: VpbCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  const kind = ctx.accountType;
  const success = kind === "HKD" ? hasReceiveQr(lines) || hasOpenRequest(lines) : hasSuccess(lines);
  const accountFound = hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, ""));
  const facts: Facts = {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    // HKD không so số tài khoản (eTax liên kết số doanh nghiệp): coi như đã có để dừng đọc sớm.
    accountFound: kind === "HKD" ? true : accountFound,
    // Mã DAO so token trọn, không cho khoảng trắng như `hasDigits`: số tiền "60 000 đ" cũng là dãy 60000.
    codeFound: hasToken(lines, ctx.referralCode.replace(/\D/g, "")),
    successFound: success,
  };
  if (programOf(ctx)) facts.programFound = hasToken(lines, programOf(ctx));
  if (kind === "none") facts.securitiesFound = success && hasSecurities(lines);
  if (kind === "CNKD") {
    facts.purposeFound = hasPhrase(lines, compact(CNKD_PURPOSE));
    facts.etaxFound = hasEtaxLink(lines) && accountFound;
  }
  if (kind === "HKD") facts.etaxFound = hasEtaxLink(lines);
  return facts;
}

export function checkVpb(texts: string[], ctx: VpbCheckContext): CheckedItem[] {
  const kind = ctx.accountType;
  return itemsFromFacts(
    texts.map((text) => vpbFacts(text, ctx)),
    {
      code: ctx.referralCode.replace(/\D/g, ""),
      codeLabel: "mã DAO",
      program: programOf(ctx),
      customerName: ctx.customerName,
      accountNumber: kind === "HKD" ? "" : ctx.accountNumber,
      securities: kind === "none",
      purpose: kind === "CNKD" ? CNKD_PURPOSE : "",
      etax: kind === "CNKD" || kind === "HKD",
      transfer:
        kind === "HKD"
          ? {
              label: "QR nhận tiền hoặc yêu cầu mở tài khoản",
              issue: "Thiếu ảnh QR nhận tiền",
              note: "Không ảnh nào là màn QR nhận tiền hay yêu cầu mở tài khoản đã khởi tạo.",
            }
          : undefined,
    },
  );
}

export async function checkVpbImages(images: Buffer[], ctx: VpbCheckContext): Promise<CheckedItem[]> {
  return checkVpb(await readUntilFound(images, (text) => vpbFacts(text, ctx)), ctx);
}
