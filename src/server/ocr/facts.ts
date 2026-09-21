import { ocrLines } from "./reader";
import type { CheckedItem } from "./types";

/**
 * Chấm bằng tìm giá trị: trong bộ ảnh của một tài khoản phải thấy đủ BỐN giá
 * trị hệ thống, ở ảnh nào cũng được, không cần biết ảnh là màn nào. TPBank
 * chốt 2026-09-19, MSB theo cùng cách 2026-09-21. Mỗi ngân hàng chỉ viết hàm
 * `facts(text, ctx)` trả bốn boolean; phần đọc ảnh tới khi đủ và ra ba mục kết
 * quả nằm ở đây.
 *
 * Không trích giá trị trên ảnh để hiện: bản trước đoán "dòng chữ hoa gần số
 * tài khoản nhất" là tên, gặp màn mở tài khoản thì lấy nhầm nhãn "Số tài khoản
 * thanh toán" và người duyệt đọc thấy "TAI KHOAN THANH TODN" (tài khoản
 * 5e237733, 2026-09-18). Không thấy thì chỉ nói "không tìm thấy X trong ảnh",
 * người duyệt mở ảnh xem. Không dung sai: nhân viên gõ sai một chữ số cũng
 * phải bị bắt (chốt 2026-09-14).
 */

export type Facts = {
  nameFound: boolean;
  accountFound: boolean;
  codeFound: boolean;
  successFound: boolean;
};

/** Giá trị hệ thống để người duyệt biết phải tìm gì khi mở ảnh. */
export type FactValues = {
  /** Mã hiện trên ảnh. `''` = mã QR-only, không so được. */
  code: string;
  customerName: string;
  accountNumber: string;
};

export const NO_FACTS: Facts = { nameFound: false, accountFound: false, codeFound: false, successFound: false };

const FACT_KEYS = Object.keys(NO_FACTS) as (keyof Facts)[];

export const mergeFacts = (a: Facts, b: Facts): Facts =>
  Object.fromEntries(FACT_KEYS.map((k) => [k, a[k] || b[k]])) as Facts;

export const allFound = (f: Facts) => FACT_KEYS.every((k) => f[k]);

/**
 * Đọc từng ảnh cho tới khi cả bộ đủ bốn giá trị; ảnh còn lại không đọc,
 * chuỗi rỗng giữ chỗ để `photoIndex` vẫn đúng.
 */
export async function readUntilFound(images: Buffer[], facts: (text: string) => Facts): Promise<string[]> {
  const texts: string[] = [];
  let have = NO_FACTS;
  for (const image of images) {
    if (allFound(have)) {
      texts.push("");
      continue;
    }
    const text = (await ocrLines(image)).join("\n");
    texts.push(text);
    have = mergeFacts(have, facts(text));
  }
  return texts;
}

/**
 * Ba mục kết quả từ bốn giá trị của từng ảnh. Ba key `open` / `home` /
 * `transfer` là key giao diện đang dùng: `open` = mã giới thiệu, `home` = tên
 * và số tài khoản, `transfer` = chuyển khoản thành công. `found` luôn rỗng:
 * không đoán giá trị trên ảnh.
 */
export function itemsFromFacts(facts: Facts[], values: FactValues): CheckedItem[] {
  const photoOf = (key: keyof Facts): number | undefined => {
    const at = facts.findIndex((f) => f[key]);
    return at >= 0 ? at : undefined;
  };
  const item = (
    key: CheckedItem["key"],
    label: string,
    expected: string,
    photoIndex: number | undefined,
    issues: string[],
    note: string,
  ): CheckedItem => ({
    key,
    verdict: issues.length ? "fail" : "pass",
    label,
    issues,
    found: "",
    expected,
    note,
    photoIndex,
  });

  const codeAt = photoOf("codeFound");
  const nameAt = photoOf("nameFound");
  const accountAt = photoOf("accountFound");
  const successAt = photoOf("successFound");

  const homeIssues: string[] = [];
  const homeNotes: string[] = [];
  if (nameAt === undefined) {
    homeIssues.push("Không tìm thấy tên khách hàng");
    homeNotes.push(`Không tìm thấy tên ${values.customerName} trong ảnh.`);
  }
  if (accountAt === undefined) {
    homeIssues.push("Không tìm thấy số tài khoản");
    homeNotes.push(`Không tìm thấy số tài khoản ${values.accountNumber} trong ảnh.`);
  }

  return [
    !values.code
      ? item("open", "Mã giới thiệu", "", undefined, [], "Mã đã chọn không có mã chữ, không so được.")
      : item(
          "open",
          "Mã giới thiệu",
          values.code,
          codeAt,
          codeAt === undefined ? ["Không tìm thấy mã giới thiệu"] : [],
          codeAt === undefined ? `Không tìm thấy mã ${values.code} trong ảnh.` : "",
        ),
    item(
      "home",
      "Tên khách hàng và số tài khoản",
      [values.customerName, values.accountNumber].filter(Boolean).join(" - "),
      nameAt ?? accountAt,
      homeIssues,
      homeNotes.join(" "),
    ),
    item(
      "transfer",
      "Giao dịch thành công",
      "",
      successAt,
      successAt === undefined ? ["Thiếu ảnh giao dịch thành công"] : [],
      successAt === undefined ? "Không ảnh nào có dòng chuyển khoản thành công." : "",
    ),
  ];
}
