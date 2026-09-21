import { codeKey, compact, hasDigits, hasLabel, hasPhrase, letterWords, lineHasName, linesHaveCode, splitLines, stripAccents } from "../text";
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
 * Dòng có đúng giá trị không: bỏ nhãn "Chọn Tỉnh/Thành phố" / "Chọn chi nhánh
 * hỗ trợ" nếu bộ dò gộp nhãn với ô, còn lại phải khớp trọn, dư mỗi đầu tối
 * đa 2 ký tự (biểu tượng vị trí đọc thành chữ).
 */
function lineHasPlace(line: string, expected: string): boolean {
  if (!expected) return false;
  const c = placeKey(line.replace(/^\s*Ch[oọ]n\s+(?:T[iỉ]nh\/Th[àa]nh ph[oố]|chi nh[áa]nh h[oỗ] tr[oợ])\s*/iu, ""));
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
  if (hasPhrase(lines, "TIENRA") && amount) return true;
  return lines.some((l) => hasLabel(l, "THONGBAOBIENDONGSODU")) && amount;
}

export function mbFacts(ocrText: string, ctx: MbCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  const facts: Facts = {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: linesHaveCode(lines, codeKey(mbReferral(ctx))),
    successFound: hasSuccess(lines),
  };
  if (ctx.province && !flexible(ctx.province))
    facts.provinceFound = lines.some((line) => lineHasPlace(line, placeKey(ctx.province)));
  if (ctx.supportBranch && !flexible(ctx.supportBranch))
    facts.branchFound = lines.some((line) => lineHasPlace(line, placeKey(ctx.supportBranch)));
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
