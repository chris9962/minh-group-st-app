import { hasPhrase, letterWords, lineHasName, linesHaveExactCode, splitLines, stripAccents } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh BIDV, viết 2026-10-03 theo cách của `tpbank.ts`:
 *
 *   1. tên khách       màn "Chi tiết tài khoản" (Tên chủ tài khoản)
 *   2. mã giới thiệu   Mã text, màn "Khai báo thông tin" bước 3/4 in `162711`
 *   3. giao dịch       tab "Toàn bộ GD tại BIDV" có dòng tiền VND
 *
 * Không so số tài khoản: hệ thống lưu số điện thoại, còn app BIDV chỉ in số tài
 * khoản riêng của ngân hàng (`8930352477`), không màn nào in số điện thoại.
 *
 * Mã text so nguyên văn, chỉ bỏ dấu và viết hoa; trống thì không so.
 */

export type BidvCheckContext = {
  referralCode: string;
  customerName: string;
};

const AMOUNT = /\d[\d,.]*\s*VND/i;

const hasSuccess = (lines: string[]): boolean =>
  hasPhrase(lines, "TOANBOGDTAIBIDV") && lines.some((l) => AMOUNT.test(stripAccents(l)));

export function bidvFacts(ocrText: string, ctx: BidvCheckContext): Facts {
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

export function checkBidv(texts: string[], ctx: BidvCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => bidvFacts(text, ctx)),
    { code: ctx.referralCode.trim(), customerName: ctx.customerName, accountNumber: "" },
  );
}

export async function checkBidvImages(images: Buffer[], ctx: BidvCheckContext): Promise<CheckedItem[]> {
  return checkBidv(await readUntilFound(images, (text) => bidvFacts(text, ctx)), ctx);
}
