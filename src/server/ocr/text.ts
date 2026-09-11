/**
 * Đồ nghề chung để tách chữ OCR thành trường, cho mọi ngân hàng dùng.
 *
 * Chữ OCR không sạch: dấu đọc sai (`Hiệu lực tù`), mất khoảng trắng
 * (`Sốtikhoảnthanhtoán`), mất mép trái vì bóng tay (`lới thiệu AT106`). Nên so
 * nhãn sau khi bỏ dấu, bỏ mọi ký tự không phải chữ số, và cho sai vài ký tự.
 */

export const stripAccents = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");

/** Chỉ còn A-Z và 0-9, viết hoa. `Số tài khoản:` thành `SOTAIKHOAN`. */
export const compact = (s: string): string => stripAccents(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Dòng có chứa nhãn không, ở bất kỳ vị trí nào.
 *
 * Cho sai 1 ký tự mỗi 6 ký tự nhãn, ít nhất 1. Không đòi "bắt đầu bằng nhãn":
 * ảnh chụp cả viền điện thoại thì OCR nhét rác trước nhãn.
 */
export function hasLabel(line: string, label: string): boolean {
  const c = compact(line);
  const tolerance = Math.max(1, Math.floor(label.length / 6));
  for (let i = 0; i + label.length <= c.length; i++) {
    if (levenshtein(c.slice(i, i + label.length), label) <= tolerance) return true;
  }
  return false;
}

/** Một trường cần tách: nhãn nào nhận ra dòng, regex nào lấy giá trị. */
export type FieldSpec = {
  /**
   * Thử theo thứ tự: nhãn đầy đủ trước, nhãn ngắn ở đuôi sau. Nhãn ngắn dễ
   * bắt nhầm, nên dòng chỉ được nhận khi `value` cũng khớp trên dòng đó.
   */
  labels: string[];
  /** Chạy trên dòng đã bỏ dấu; lấy `[0]`. */
  value: RegExp;
  clean?: (v: string) => string;
};

/** Giá trị của một trường trong danh sách dòng, `''` khi không thấy. */
export function pickField(lines: string[], spec: FieldSpec): string {
  for (const label of spec.labels) {
    for (const line of lines) {
      if (!hasLabel(line, label)) continue;
      // Regex chạy trên dòng đã bỏ dấu: giá trị toàn số và chữ không dấu,
      // còn chữ nhãn có dấu thì không khớp nhầm được regex.
      const m = stripAccents(line).match(spec.value);
      if (m) return spec.clean ? spec.clean(m[0]) : m[0];
    }
  }
  return "";
}

/** Có dòng nào chứa cụm này không, so sau khi `compact`. */
export const hasPhrase = (lines: string[], phrase: string): boolean =>
  lines.some((l) => compact(l).includes(phrase));

export const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** `dd/mm/yyyy` sang `yyyy-mm-dd`. */
export const isoDate = (v: string): string => v.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1");
