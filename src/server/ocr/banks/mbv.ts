import { hasDigits, hasLabel, letterWords, lineHasName, linesHaveExactCode, splitLines } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";
import { mbFallbackCode } from "./mb";

/**
 * Kiểm ảnh MBV, viết 2026-10-03 theo cách của `tpbank.ts`:
 *
 *   1. tên khách       màn "Đăng ký thành công" (Tên tài khoản)
 *   2. số tài khoản    = số điện thoại, màn "Đăng ký thành công" in `0984 9260 50`
 *   3. mã giới thiệu   Mã text, màn "Xác nhận thông tin" in `A101 - MBV CHI LINH`
 *   4. giao dịch       chứng từ "Giao dịch thành công"
 *
 * Mã text so nguyên văn, chỉ bỏ dấu và viết hoa; trống thì không so.
 *
 * Mã có O, I, 0, 1 thì gửi kèm yêu cầu đọc để Paddle đọc lại vùng lệch như MB
 * (`mbFallbackCode`): mã D040 ngày 2026-11-03 VietOCR đọc ra `DO4O`, 44/44 không đạt.
 */

export type MbvCheckContext = {
  referralCode: string;
  customerName: string;
  accountNumber: string;
};

function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  return joined.some((l) => hasLabel(l, "GIAODICHTHANHCONG"));
}

export function mbvFacts(ocrText: string, ctx: MbvCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  return {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: linesHaveExactCode(lines, ctx.referralCode),
    successFound: hasSuccess(lines),
  };
}

export function checkMbv(texts: string[], ctx: MbvCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => mbvFacts(text, ctx)),
    { code: ctx.referralCode.trim(), customerName: ctx.customerName, accountNumber: ctx.accountNumber },
  );
}

export async function checkMbvImages(images: Buffer[], ctx: MbvCheckContext): Promise<CheckedItem[]> {
  const texts = await readUntilFound(
    images,
    (text) => mbvFacts(text, ctx),
    "transformer",
    undefined,
    mbFallbackCode(ctx.referralCode),
  );
  return checkMbv(texts, ctx);
}
