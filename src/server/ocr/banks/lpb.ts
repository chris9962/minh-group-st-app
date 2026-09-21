import { hasDigits, hasLabel, hasPhrase, letterWords, lineHasName, splitLines, stripAccents } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh LPBank, viết lại 2026-09-22 theo cách của `tpbank.ts`: tìm giá trị
 * hệ thống trong chữ của cả bộ ảnh, không nhận màn, không dung sai, xem
 * `facts.ts`. Năm giá trị, đo trên 40 tài khoản:
 *
 *   1. mã giới thiệu   = số điện thoại người giới thiệu, màn "Giới thiệu bạn
 *                       bè" mục "Người giới thiệu của tôi"
 *   2. tên khách       màn "Thông tin tài khoản" (Chủ tài khoản), màn chuyển tiền
 *   3. số tài khoản    = số điện thoại khách, cùng màn Thông tin tài khoản
 *   4. ngày mở         "Ngày mở tài khoản: dd/mm/yyyy" cùng màn
 *   5. giao dịch       xem `hasSuccess`
 *
 * Bản trước nhận màn và cho sai 2 số mã khi tên người giới thiệu khớp; bỏ dung
 * sai đó: sai một số là mã của người khác.
 */

export type LpbCheckContext = {
  /** `referral_codes.code`: số điện thoại người giới thiệu. */
  referralCode: string;
  /** `referral_codes.display_name`: tên người giới thiệu, chỉ để hiện. */
  referralName: string;
  customerName: string;
  /** Số điện thoại khách. */
  accountNumber: string;
  /** `bank_accounts.opened_date`, YYYY-MM-DD. `''` = chưa có. */
  openedDate: string;
};

/** `2026-09-08` thành `08/09/2026` như in trên màn. */
export const displayDate = (iso: string): string => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1");

/** Ngày hệ thống có trong chữ không, đúng từng số, cho khoảng trắng quanh dấu `/`. */
function hasDate(text: string, expected: string): boolean {
  if (!expected) return false;
  const pattern = expected.replace(/\//g, "\\s*/\\s*");
  return new RegExp(`(?<!\\d)${pattern}(?!\\d)`).test(text);
}

const AMOUNT = /\d[\d,.]*\s*VND/i;

/**
 * Giao dịch đã ghi nhận: chứng từ "Chuyển tiền thành công" / "Giao dịch thành
 * công", hoặc "Biến động số dư" / "Lịch sử giao dịch" kèm dòng tiền.
 */
function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  if (joined.some((l) => hasLabel(l, "CHUYENTIENTHANHCONG") || hasLabel(l, "GIAODICHTHANHCONG"))) return true;
  const amount = lines.some((l) => AMOUNT.test(stripAccents(l)));
  return (hasPhrase(lines, "BIENDONGSODU") || hasPhrase(lines, "LICHSUGIAODICH")) && amount;
}

/** Màn Thông tin tài khoản in nhãn và tên trên cùng một dòng: "Chủ tài khoản SON THI NGOC SANG". */
const OWNER_LABEL = /ch[uủ]\s*t[àa]i\s*kho[aả]n[.,:]?\s*/iu;

export function lpbFacts(ocrText: string, ctx: LpbCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  const facts: Facts = {
    nameFound: lines.some((line) => lineHasName(line.replace(OWNER_LABEL, ""), expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: hasDigits(ocrText, ctx.referralCode.replace(/\D/g, "")),
    successFound: hasSuccess(lines),
  };
  if (ctx.openedDate) facts.openedDateFound = hasDate(ocrText, displayDate(ctx.openedDate));
  return facts;
}

export function checkLpb(texts: string[], ctx: LpbCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => lpbFacts(text, ctx)),
    {
      code: ctx.referralCode.replace(/\D/g, ""),
      customerName: ctx.customerName,
      accountNumber: ctx.accountNumber,
      openedDate: displayDate(ctx.openedDate),
    },
  );
}

export async function checkLpbImages(images: Buffer[], ctx: LpbCheckContext): Promise<CheckedItem[]> {
  return checkLpb(await readUntilFound(images, (text) => lpbFacts(text, ctx)), ctx);
}
