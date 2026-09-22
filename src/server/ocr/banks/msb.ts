import { codeKey, hasDigits, hasLabel, hasPhrase, letterWords, lineHasName, linesHaveCode, splitLines, stripAccents } from "../text";
import { itemsFromFacts, readUntilFound, type Facts } from "../facts";
import type { CheckedItem } from "../types";

/**
 * Kiểm ảnh MSB (MSBa, MSBb), viết lại 2026-09-21 theo cách của `tpbank.ts`:
 * tìm bốn giá trị hệ thống trong chữ của cả bộ ảnh, không nhận màn, không
 * dung sai, xem `facts.ts`.
 *
 *   1. tên khách       màn "Đăng ký dịch vụ MSB Digibank thành công" (Chủ tài
 *                      khoản), màn chuyển tiền (Người chuyển, lời nhắn
 *                      "TÊN chuyen tien"), tab Biến động số dư
 *   2. số tài khoản    màn đăng ký, "Tài khoản liên kết" ở Chi tiết thẻ, nội
 *                      dung thông báo "80003882939-Ref …"
 *   3. mã giới thiệu   bước "2.3 Bổ sung thông tin"
 *   4. chuyển khoản    xem `hasSuccess`
 *
 * Bản trước nhận màn rồi trích giá trị so có dung sai, không so số tài khoản,
 * và so Chi nhánh/PGD với chữ cấu hình gõ tay ("Pdg: hoàng cầu", "CN: LONG
 * BIÊN") nên 325 lượt báo sai dù ảnh đúng. Bỏ phép so chi nhánh 2026-09-21.
 */

export type MsbCheckContext = {
  /** `referral_codes.code`, kèm chú thích phòng hay " - MCT: …" ở sau mã. */
  referralCode: string;
  customerName: string;
  accountNumber: string;
};

/**
 * Mã hiện trên ảnh: token đầu của `code` (`MGST2026`, `DNS960`, `XPDFTGF-5`).
 * Phần sau token là chú thích phòng hay "MCT: CTV1", không có trên ô "Mã giới
 * thiệu".
 *
 * KHÔNG đọc `display_name` nữa (chốt 2026-09-22). Bản trước ưu tiên trường đó
 * vì tưởng nó luôn là mã ngắn, nhưng 14 mã nhóm DNS960 ghi nhãn ở đầu —
 * `"MGT: DNS960  - MCT: Trống (py)"`, một mã ghi `"P2MGT: …"` — nên token đầu
 * ra `MGT` và 335 tài khoản MSBb báo thiếu mã giới thiệu oan.
 */
export function msbReferral(ctx: Pick<MsbCheckContext, "referralCode">): string {
  return ctx.referralCode.trim().match(/^[A-Z0-9]+(?:-\d+)?/i)?.[0]?.toUpperCase() ?? "";
}

/** Nội dung giao dịch đi của MSB luôn là `<STK>-Ref <mã>-CK 24/7 cho …`. */
const TRANSFER_REF = /(?:^|[^A-Za-z])Ref(?:[^A-Za-z]|$)/;

/**
 * Chuyển khoản thành công, bốn dạng ảnh đo trên 60 tài khoản 2026-09-21:
 *
 * - 46 màn kết quả có tiêu đề "Chuyển tiền thành công" (TPBank in "Chuyển
 *   thành công", khác chữ). So cả hai dòng liền nhau ghép lại vì bộ dò vùng có
 *   khi tách tiêu đề.
 * - 8 màn kết quả bị thông báo đẩy che tiêu đề: phần còn lại vẫn có "Người
 *   chuyển", "Nội dung chuyển tiền" và nút "Giao dịch khác". Đòi nút đó để
 *   màn xác nhận trước khi chuyển không đạt nhầm.
 * - 5 tab "Biến động số dư" và 1 mục "Lịch sử giao dịch" của màn Tài khoản
 *   thanh toán: từng giao dịch kèm nội dung "…-Ref …". Không dùng dấu tiền
 *   `-50,000`: OCR đọc mất dấu hoặc đọc `+` thành `4`. Không dùng "Lịch sử
 *   giao dịch" + dòng VND như TPBank: màn Chi tiết thẻ cũng có hai thứ đó mà
 *   ghi "Chưa có giao dịch được thực hiện".
 */
function hasSuccess(lines: string[]): boolean {
  const joined = lines.concat(lines.slice(1).map((next, i) => `${lines[i]} ${next}`));
  if (joined.some((l) => hasLabel(l, "CHUYENTIENTHANHCONG") || hasLabel(l, "GIAODICHTHANHCONG"))) return true;
  if (hasPhrase(lines, "NGUOICHUYEN") && hasPhrase(lines, "NOIDUNGCHUYENTIEN") && hasPhrase(lines, "GIAODICHKHAC")) return true;
  return (
    (hasPhrase(lines, "BIENDONGSODU") || hasPhrase(lines, "LICHSUGIAODICH")) &&
    lines.some((l) => TRANSFER_REF.test(stripAccents(l)))
  );
}

/** Bốn giá trị hệ thống có trong chữ của MỘT ảnh không. */
export function msbFacts(ocrText: string, ctx: MsbCheckContext): Facts {
  const lines = splitLines(ocrText);
  const expectedName = letterWords(ctx.customerName).join("");
  return {
    nameFound: lines.some((line) => lineHasName(line, expectedName)),
    accountFound: hasDigits(ocrText, ctx.accountNumber.replace(/\D/g, "")),
    codeFound: linesHaveCode(lines, codeKey(msbReferral(ctx))),
    successFound: hasSuccess(lines),
  };
}

/** Chấm trên chữ đã OCR, mỗi chuỗi một ảnh; hàm thuần để benchmark chạy trên chữ cache. */
export function checkMsb(texts: string[], ctx: MsbCheckContext): CheckedItem[] {
  return itemsFromFacts(
    texts.map((text) => msbFacts(text, ctx)),
    { code: msbReferral(ctx), customerName: ctx.customerName, accountNumber: ctx.accountNumber },
  );
}

export async function checkMsbImages(images: Buffer[], ctx: MsbCheckContext): Promise<CheckedItem[]> {
  return checkMsb(await readUntilFound(images, (text) => msbFacts(text, ctx)), ctx);
}
