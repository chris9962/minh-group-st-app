import { codeKey, codeTokens, compact, hasDigits, hasLabel, letterWords, lineHasName, splitLines, stripAccents } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh MB, viết lại 2026-09-22 theo cách của `tpbank.ts`: tìm giá trị hệ
 * thống trong chữ của cả bộ ảnh, không nhận màn, không dung sai, xem `facts.ts`.
 * Sáu giá trị, đo trên 40 tài khoản:
 *
 *   1. mã giới thiệu     màn "Đăng ký tài khoản", ô "Mã người giới thiệu (Mã RM)"
 *   2. Tỉnh/Thành phố    cùng màn, ô "Chọn Tỉnh/Thành phố"
 *   3. Chi nhánh hỗ trợ  cùng màn, ô "Chọn chi nhánh hỗ trợ"
 *   4. tên khách         màn "Hồ sơ người dùng"; lời nhắn "CUSTOMER MBCT TÊN chuyen tien"
 *   5. số tài khoản      = số điện thoại: "User ID" ở Hồ sơ người dùng, ô
 *                        "Nhập số điện thoại" ở màn đăng ký
 *   6. giao dịch         xem `hasSuccess`
 *
 * Mã MB không có mã chữ (`referral_codes.code` rỗng); mã trên ảnh là token
 * đầu của `display_name` ("Q607-Truong Duy-CN Tiền Giang"). Tỉnh và chi nhánh
 * lấy từ `province` / `support_branch` của mã, đã có cấu trúc ("Cần Thơ",
 * "CN Tây Đô"), khác MSB gõ tay nên so được.
 */

export type MbCheckContext = {
  referralCode: string;
  referralName: string;
  province: string;
  supportBranch: string;
  customerName: string;
  accountNumber: string;
};

/** Mã RM hiện trên ảnh: token đầu của `display_name` ("o826 chữ O -…" là `O826`). */
export const mbReferral = (ctx: Pick<MbCheckContext, "referralCode" | "referralName">): string =>
  (ctx.referralName || ctx.referralCode).trim().match(/^[A-Z0-9]{3,6}/i)?.[0]?.toUpperCase() ?? "";

/**
 * VietOCR đọc chữ T, Q của mã RM trên app MB thành 1, 0: `T771` ra `1771`,
 * `Q135` ra `0135` (đo 2026-09-26). 272 mã MB không có hai mã trùng nhau sau
 * khi gộp, nên gộp không làm nhận nhầm người.
 */
const mbCodeKey = (value: string): string => codeKey(value).replace(/T/g, "1").replace(/Q/g, "0");

/**
 * VietOCR đọc thừa một chữ số trong dãy lặp: `0949999701` ra `09499999701`
 * (đo 2026-09-26). Mỗi dãy lặp trong số hệ thống được dài thêm đúng một chữ
 * số, không được ngắn đi. Số MB luôn là SĐT 10 số nên 11 số chỉ có thể là OCR.
 */
function hasPhone(text: string, expected: string): boolean {
  if (hasDigits(text, expected)) return true;
  const runs = expected.match(/(\d)\1*/g);
  if (!runs) return false;
  const body = runs
    .map((run) => run.split("").join("\\s*") + (run.length > 1 ? `(?:\\s*${run[0]})?` : ""))
    .join("\\s*");
  return new RegExp(`(?<!\\d)${body}(?!\\d)`).test(text);
}

const flexible = (value: string): boolean => compact(value).includes("TUCHON");

/**
 * Cấu hình về dạng in trên màn: tỉnh không có chữ "Tỉnh"/"Thành phố" ("Tỉnh
 * An Giang" → `ANGIANG`); chi nhánh viết tắt `CN`, `PGD`, kể cả người cấu hình
 * gõ "MB Tân Hương" cho "CN Tân Hương".
 */
const placeKey = (value: string): string =>
  compact(value)
    .replace(/^(?:TINH|THANHPHO|TP)(?=[A-Z])/, "")
    .replace(/^(?:CHINHANH|MB)(?=[A-Z])/, "CN")
    .replace(/^PHONGGIAODICH/, "PGD");

/**
 * App MB in tên chi nhánh không đều: "CN Đắk Lắk" có tiền tố, "Mê Linh", "Tân
 * Sơn Nhất", "Tân Thuận" thì không, "SMB Đô Lương" in "SMB PGD Đô Lương" (đo
 * 2026-09-26, 141 tài khoản không đạt oan). Nên so phần tên sau tiền tố.
 */
const branchName = (key: string): string => key.replace(/^(?:CN|PGD|SMB)+(?=[A-Z])/, "");

/**
 * Dòng có đúng giá trị không: bỏ nhãn "Chọn Tỉnh/Thành phố" / "Chọn chi nhánh
 * hỗ trợ" nếu bộ dò gộp nhãn với ô, còn lại phải khớp trọn, dư mỗi đầu tối
 * đa 2 ký tự (biểu tượng vị trí đọc thành chữ).
 */
function lineHasPlace(line: string, expected: string, key: (value: string) => string = placeKey): boolean {
  if (!expected) return false;
  const c = key(line.replace(/^\s*Ch[oọ]n\s+(?:T[iỉ]nh\/Th[àa]nh ph[oố]|chi nh[áa]nh h[oỗ] tr[oợ])\s*/iu, ""));
  for (let at = c.indexOf(expected); at >= 0; at = c.indexOf(expected, at + 1)) {
    if (at <= 2 && c.length - at - expected.length <= 2) return true;
  }
  return false;
}

const AMOUNT = /\d[\d,.]*\s*VND/i;

/**
 * Giao dịch đã ghi nhận, ba dạng: chứng từ "Chuyển tiền thành công" / "Giao
 * dịch thành công"; danh sách "Truy vấn giao dịch" có dòng "TIỀN RA" kèm số
 * tiền; "Thông báo biến động số dư" kèm số tiền. "Đã hủy đăng ký thiết bị" cũng
 * in dấu tick nhưng không có tiền, không tính.
 */
function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  if (joined.some((l) => hasLabel(l, "CHUYENTIENTHANHCONG") || hasLabel(l, "GIAODICHTHANHCONG"))) return true;
  const amount = lines.some((l) => AMOUNT.test(stripAccents(l)));
  // Nhãn "TIỀN RA" là một vùng riêng, dư mỗi đầu tối đa 2 ký tự (biểu tượng đọc
  // thành chữ): "hạn mức chuyển tiền ra ngoài" cũng chứa TIENRA nhưng dài hơn.
  const outgoingLabel = lines.some((l) => {
    const c = compact(l);
    const at = c.indexOf("TIENRA");
    return at >= 0 && at <= 2 && c.length - at - "TIENRA".length <= 2;
  });
  if (outgoingLabel && amount) return true;
  return lines.some((l) => hasLabel(l, "THONGBAOBIENDONGSODU")) && amount;
}

export function mbFacts(ocrText: string, ctx: MbCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  const expectedCode = mbCodeKey(mbReferral(ctx));
  // Lịch sử giao dịch xuống dòng giữa tên và "chuyen tien": "CUSTOMERMBCT NGUYEN VAN CUA" / "chuyen tien D26…".
  const pairs = lines.slice(1).map((next, i) => `${lines[i]} ${next}`);
  const facts: Facts = {
    nameFound: lines.concat(pairs).some((line) => lineHasName(line, expectedName)),
    accountFound: hasPhone(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: Boolean(expectedCode) && lines.some((line) => codeTokens(line).some((t) => mbCodeKey(t) === expectedCode)),
    successFound: hasSuccess(lines),
  };
  if (ctx.province && !flexible(ctx.province))
    facts.provinceFound = lines.some((line) => lineHasPlace(line, placeKey(ctx.province)));
  if (ctx.supportBranch && !flexible(ctx.supportBranch)) {
    const branch = placeKey(ctx.supportBranch);
    const name = branchName(branch);
    facts.branchFound = lines.some(
      (line) =>
        lineHasPlace(line, branch) ||
        // "CN Đắk Lắk" ở tỉnh Đắk Lắk: bỏ tiền tố thì dòng tỉnh cũng khớp, nên phải còn tiền tố.
        (name !== placeKey(ctx.province) && lineHasPlace(line, name, (value) => branchName(placeKey(value)))),
    );
  }
  return facts;
}

export function checkMb(texts: string[], ctx: MbCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => mbFacts(text, ctx)),
    {
      code: mbReferral(ctx),
      customerName: ctx.customerName,
      accountNumber: ctx.accountNumber,
      province: flexible(ctx.province) ? "" : ctx.province,
      supportBranch: flexible(ctx.supportBranch) ? "" : ctx.supportBranch,
    },
  );
}

export async function checkMbImages(images: Buffer[], ctx: MbCheckContext): Promise<CheckedItem[]> {
  return checkMb(await readUntilFound(images, (text) => mbFacts(text, ctx)), ctx);
}
