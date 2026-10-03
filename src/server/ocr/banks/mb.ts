import { compact, exactText, hasDigits, hasLabel, letterWords, lineHasName, linesHaveExactCode, splitLines, stripAccents } from "../text";
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
 * Mã RM so nguyên văn `referral_codes.code`, tỉnh và chi nhánh so nguyên văn
 * `province` / `support_branch`; chỉ bỏ dấu và viết hoa (chốt 2026-10-02).
 * Mã text trống thì không so mã: 349/350 mã MB đang để trống, mã RM chỉ nằm ở
 * `display_name`.
 */

export type MbCheckContext = {
  referralCode: string;
  province: string;
  supportBranch: string;
  customerName: string;
  accountNumber: string;
};

const flexible = (value: string): boolean => compact(value).includes("TUCHON");

/**
 * Dòng đúng bằng giá trị cấu hình. Chỉ bỏ nhãn "Chọn Tỉnh/Thành phố" / "Chọn
 * chi nhánh hỗ trợ" khi bộ dò gộp nhãn với ô; không so chuỗi con vì tỉnh "An
 * Giang" nằm trong dòng chi nhánh "CN An Giang".
 */
function lineHasPlace(line: string, expected: string): boolean {
  const value = line.replace(/^\s*Ch[oọ]n\s+(?:T[iỉ]nh\/Th[àa]nh ph[oố]|chi nh[áa]nh h[oỗ] tr[oợ])\s*/iu, "");
  return exactText(value) === exactText(expected);
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
  const facts: Facts = {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: linesHaveExactCode(lines, ctx.referralCode),
    successFound: hasSuccess(lines),
  };
  if (ctx.province && !flexible(ctx.province))
    facts.provinceFound = lines.some((line) => lineHasPlace(line, ctx.province));
  if (ctx.supportBranch && !flexible(ctx.supportBranch))
    facts.branchFound = lines.some((line) => lineHasPlace(line, ctx.supportBranch));
  return facts;
}

export function checkMb(texts: string[], ctx: MbCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => mbFacts(text, ctx)),
    {
      code: ctx.referralCode.trim(),
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
