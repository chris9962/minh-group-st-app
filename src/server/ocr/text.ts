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
 *
 * Cửa sổ so sánh rộng từ `label.length - tolerance` tới `label.length +
 * tolerance`. Bản trước chỉ so cửa sổ đúng bằng độ dài nhãn, nên nhãn bị RỤNG
 * ký tự không bao giờ khớp: ảnh mờ đọc "Mở Tài Khoản Thành Công" ra
 * `MTAIKHONTHANHCONG` dài 17, ngắn hơn nhãn 19 ký tự, vòng lặp không chạy lần
 * nào (đo 2026-09-13).
 */
export function hasLabel(line: string, label: string): boolean {
  const c = compact(line);
  const tolerance = Math.max(1, Math.floor(label.length / 6));
  for (let width = Math.max(1, label.length - tolerance); width <= label.length + tolerance; width++) {
    for (let i = 0; i + width <= c.length; i++) {
      if (levenshtein(c.slice(i, i + width), label) <= tolerance) return true;
    }
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

/**
 * Tên OCR có khớp tên trong hệ thống không.
 *
 * So sau khi bỏ dấu, bỏ khoảng trắng, viết hoa: OCR hay mất khoảng trắng
 * giữa các từ và tự thêm dấu. Chấp nhận sai 1 ký tự mỗi 8 ký tự. Dùng cho
 * LPB, MB; TPBank và MSB so đúng từng ký tự bằng `lineHasName`.
 */
export function nameMatches(ocrName: string, expected: string): boolean {
  const a = compact(ocrName);
  const b = compact(expected);
  if (!a || !b) return false;
  if (a.includes(b)) return true;
  const tolerance = Math.max(1, Math.floor(b.length / 8));
  for (let i = 0; i + b.length <= a.length; i++) {
    let diff = 0;
    for (let j = 0; j < b.length && diff <= tolerance; j++) if (a[i + j] !== b[j]) diff++;
    if (diff <= tolerance) return true;
  }
  return false;
}

/* ── Tìm giá trị hệ thống trong chữ, không dung sai ───────────────────── */

/** Chỉ còn các từ chữ cái viết hoa không dấu, cách nhau một khoảng trắng. */
export const letterWords = (s: string): string[] =>
  stripAccents(s).toUpperCase().replace(/[^A-Z]+/g, " ").trim().split(" ").filter(Boolean);

/**
 * Dòng có chứa đúng tên không: chuỗi chữ cái của tên nằm trong chuỗi chữ cái
 * của dòng, đúng từng ký tự, phần dư mỗi đầu tối đa 2 chữ cái. Bỏ khoảng
 * trắng khi so vì OCR hay dính từ: `TO THICAM HON` là `TO THI CAM HON`.
 * `VW NGUYEN THI NHIEU` khớp `NGUYEN THI NHIEU` (logo và biểu tượng bàn tay
 * đọc thành chữ), `NGUYEN THI NHIEU HOA` không khớp vì dư `HOA`.
 *
 * Lời nhắn chuyển khoản do app tự điền `<tên chủ tài khoản> chuyen tien`
 * (TPBank 55/55 ảnh bộ nhãn 2026-09-14, MSB cũng vậy), nên tên nối liền
 * `CHUYENTIEN` cũng tính; nhãn "Nội dung:" đứng trước dài hơn 2 chữ cái nên
 * phải so riêng. `expected` là `letterWords(tên).join("")`.
 */
export function lineHasName(line: string, expected: string): boolean {
  if (!expected) return false;
  const letters = letterWords(line).join("");
  if (letters.includes(expected + "CHUYENTIEN")) return true;
  if (letters.length < expected.length) return false;
  for (let at = letters.indexOf(expected); at >= 0; at = letters.indexOf(expected, at + 1)) {
    if (at <= 2 && letters.length - at - expected.length <= 2) return true;
  }
  return false;
}

/**
 * Dãy số hệ thống có trong chữ OCR không: đúng từng chữ số và TRỌN dãy, trước
 * và sau không còn chữ số. Cho khoảng trắng hay xuống dòng giữa các chữ số vì
 * màn hình chính TPBank in `1000 5476 110`.
 *
 * Không so trên chuỗi chữ số của cả ảnh: nhân viên nhập `1000 5476 1` thiếu
 * hai số vẫn là chuỗi con của `10005476110` trên ảnh và đạt nhầm (tài khoản
 * 10f75c6d, đo 2026-09-15).
 */
export function hasDigits(text: string, expected: string): boolean {
  if (!expected) return false;
  return new RegExp(`(?<!\\d)${expected.split("").join("\\s*")}(?!\\d)`).test(text);
}

/**
 * Mã giới thiệu so sau khi bỏ dấu, viết hoa, và gộp ký tự dễ nhầm: `O`/`0`,
 * `I`/`1`, `S`/`5`, `B`/`8`, `Z`/`2`. Không cho sai ký tự: `AT105` và `AT106`
 * là hai mã của hai người, sai một ký tự là sai người.
 */
export const codeKey = (s: string): string =>
  compact(s).replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");

/**
 * Token chữ-số của một dòng, kèm mỗi cặp token liền nhau ghép lại: OCR đọc
 * `AT107` trên ảnh chụp lại thành `ATI 07`, ghép hai token là ra mã, còn `I`
 * thì `codeKey` đã gộp với `1`. Mã MSB có gạch nối `YPHPDVC-5` cũng ra từ
 * cặp ghép.
 */
export function codeTokens(line: string): string[] {
  const tokens = stripAccents(line).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return tokens.concat(tokens.slice(1).map((next, i) => tokens[i] + next));
}

/** Dòng nào có mã hệ thống không, `expected` là `codeKey(mã)`. */
export const linesHaveCode = (lines: string[], expected: string): boolean =>
  Boolean(expected) && lines.some((line) => codeTokens(line).some((t) => codeKey(t) === expected));
