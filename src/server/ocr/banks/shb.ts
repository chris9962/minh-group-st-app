import { hasDigits, hasLabel, letterWords, lineHasName, linesHaveExactCode, splitLines } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh SHB, viết 2026-10-03 theo cách của `tpbank.ts`:
 *
 *   1. tên khách       màn "Mở tài khoản thành công" (Tên tài khoản), lời nhắn
 *                      "TÊN chuyen tien"
 *   2. số tài khoản    = số điện thoại: "Tên đăng nhập", ô "Số điện thoại".
 *                      Ô "Số tài khoản" có khi in thêm `00` ở đầu (`000377046597`)
 *                      nên không đứng riêng một mình
 *   3. mã giới thiệu   Mã text, form đăng ký của TapTap in `TT2468`
 *   4. giao dịch       chứng từ "Giao dịch thành công"
 *
 * Mã text so nguyên văn, chỉ bỏ dấu và viết hoa; trống thì không so.
 */

export type ShbCheckContext = {
  referralCode: string;
  customerName: string;
  accountNumber: string;
};

function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  return joined.some((l) => hasLabel(l, "GIAODICHTHANHCONG"));
}

export function shbFacts(ocrText: string, ctx: ShbCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  return {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: linesHaveExactCode(lines, ctx.referralCode),
    successFound: hasSuccess(lines),
  };
}

export function checkShb(texts: string[], ctx: ShbCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => shbFacts(text, ctx)),
    { code: ctx.referralCode.trim(), customerName: ctx.customerName, accountNumber: ctx.accountNumber },
  );
}

export async function checkShbImages(images: Buffer[], ctx: ShbCheckContext): Promise<CheckedItem[]> {
  return checkShb(await readUntilFound(images, (text) => shbFacts(text, ctx)), ctx);
}
