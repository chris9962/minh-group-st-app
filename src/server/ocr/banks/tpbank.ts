import { codeKey, hasDigits, hasLabel, hasPhrase, letterWords, lineHasName, linesHaveCode, splitLines, stripAccents } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh TPBank, chốt 2026-09-19: trong bộ ảnh của một tài khoản phải thấy
 * đủ BỐN giá trị, ở ảnh nào cũng được, không cần biết ảnh là màn nào (cách
 * chấm chung ở `facts.ts`):
 *
 *   1. tên khách                 đúng từng chữ cái sau khi bỏ dấu
 *   2. số tài khoản              đúng từng chữ số, trọn dãy
 *   3. mã giới thiệu             đúng từng ký tự sau khi gộp O/0, I/1, S/5, B/8, Z/2
 *   4. chuyển khoản thành công   có dòng "Chuyển thành công" hoặc "Giao dịch thành công"
 *
 * Chữ do `reader.ts` đọc một lượt, không tiền xử lý, không nhận màn. Bản
 * trước chọn cấu hình Tesseract theo màn; ảnh chụp lại đọc rác ở lượt đầu thì
 * rẽ nhầm nhánh và không bao giờ chạy lượt đọc được mã (tài khoản 43aebf7e,
 * 2026-09-17).
 */

export type TpbCheckContext = {
  /** `referral_codes.code` của mã đã chọn. `''` = mã QR-only, không so được. */
  referralCode: string;
  /** `customers.full_name`. */
  customerName: string;
  /** `bank_accounts.account_number` nhân viên nhập lúc hoàn thành. `''` = chưa có. */
  accountNumber: string;
};

const AMOUNT = /\d[\d,.]*\s*VND/i;

/**
 * Chuyển khoản thành công. `hasLabel` có dung sai vì ảnh chụp lại đọc
 * "Cuuyển thành công". So cả hai dòng liền nhau ghép lại: bộ dò vùng có khi
 * tách tiêu đề thành "Chuyển" và "thành công" (tài khoản 1df07195, 2026-09-19).
 * Màn "Lịch sử giao dịch" không in chữ "thành công", số dư "SD:" sau mỗi dòng
 * đã nói giao dịch chốt sổ, nên tab đó kèm dòng tiền cũng tính (chốt 2026-09-16).
 */
function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  if (joined.some((l) => hasLabel(l, "CHUYENTHANHCONG"))) return true;
  if (hasPhrase(joined, "GIAODICHTHANHCONG")) return true;
  return hasPhrase(lines, "LICHSUGIAODICH") && lines.some((l) => AMOUNT.test(stripAccents(l)));
}

/** Bốn giá trị hệ thống có trong chữ của MỘT ảnh không. */
export function tpbFacts(ocrText: string, ctx: TpbCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  return {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: linesHaveCode(lines, codeKey(ctx.referralCode)),
    successFound: hasSuccess(lines),
  };
}

/** Chấm trên chữ đã OCR, mỗi chuỗi một ảnh; hàm thuần để benchmark chạy trên chữ cache. */
export function checkTpbank(texts: string[], ctx: TpbCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => tpbFacts(text, ctx)),
    { code: ctx.referralCode, customerName: ctx.customerName, accountNumber: ctx.accountNumber },
  );
}

export async function checkTpbankImages(images: Buffer[], ctx: TpbCheckContext): Promise<CheckedItem[]> {
  return checkTpbank(await readUntilFound(images, (text) => tpbFacts(text, ctx)), ctx);
}
