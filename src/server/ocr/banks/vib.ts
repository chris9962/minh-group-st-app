import { hasDigits, hasLabel, letterWords, lineHasName, linesHaveExactCode, splitLines } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh VIB, viết 2026-10-03 theo cách của `tpbank.ts`:
 *
 *   1. tên khách       màn "Mở tài khoản thanh toán Digi" (Chủ tài khoản), màn
 *                      QR của tôi, lời nhắn "TÊN chuyen tien"
 *   2. số tài khoản    = số điện thoại: "Tên đăng nhập", "Số điện thoại" ở màn
 *                      mở thẻ. Ô "Số tài khoản" bỏ số 0 đầu (`396104652`)
 *   3. mã giới thiệu   Mã text, màn "Mở tài khoản thanh toán Digi" in `RSR`
 *   4. giao dịch       chứng từ "Chuyển tiền thành công"
 *
 * Mã text so nguyên văn, chỉ bỏ dấu và viết hoa; trống thì không so.
 */

export type VibCheckContext = {
  referralCode: string;
  customerName: string;
  accountNumber: string;
};

function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  return joined.some((l) => hasLabel(l, "CHUYENTIENTHANHCONG"));
}

export function vibFacts(ocrText: string, ctx: VibCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  return {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: linesHaveExactCode(lines, ctx.referralCode),
    successFound: hasSuccess(lines),
  };
}

export function checkVib(texts: string[], ctx: VibCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => vibFacts(text, ctx)),
    { code: ctx.referralCode.trim(), customerName: ctx.customerName, accountNumber: ctx.accountNumber },
  );
}

export async function checkVibImages(images: Buffer[], ctx: VibCheckContext): Promise<CheckedItem[]> {
  return checkVib(await readUntilFound(images, (text) => vibFacts(text, ctx)), ctx);
}
