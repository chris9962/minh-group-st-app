import { hasLabel, letterWords, lineHasName, linesHaveExactCode, splitLines } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh Techcombank, viết 2026-10-03 theo cách của `tpbank.ts`, đo trên 1
 * tài khoản (cả ngân hàng chỉ có 1 tài khoản tới ngày đó):
 *
 *   1. tên khách       màn "Mở tài khoản thành công" (Chủ tài khoản), lời nhắn
 *                      "TÊN chuyen tien"
 *   2. mã giới thiệu   Mã text; mã TCB đang là mã QR, Mã text trống nên không so
 *   3. giao dịch       chứng từ "Chuyển thành công"
 *
 * Không so số tài khoản: hệ thống lưu số điện thoại, còn app Techcombank chỉ in
 * số tài khoản riêng của ngân hàng (`19077100854019`).
 *
 * Mã text so nguyên văn, chỉ bỏ dấu và viết hoa; trống thì không so.
 */

export type TcbCheckContext = {
  referralCode: string;
  customerName: string;
};

function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  return joined.some((l) => hasLabel(l, "CHUYENTHANHCONG"));
}

export function tcbFacts(ocrText: string, ctx: TcbCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  return {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    // Không so số tài khoản: coi như đã có để dừng đọc sớm.
    accountFound: true,
    codeFound: linesHaveExactCode(lines, ctx.referralCode),
    successFound: hasSuccess(lines),
  };
}

export function checkTcb(texts: string[], ctx: TcbCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => tcbFacts(text, ctx)),
    { code: ctx.referralCode.trim(), customerName: ctx.customerName, accountNumber: "" },
  );
}

export async function checkTcbImages(images: Buffer[], ctx: TcbCheckContext): Promise<CheckedItem[]> {
  return checkTcb(await readUntilFound(images, (text) => tcbFacts(text, ctx)), ctx);
}
