import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);

/**
 * Đọc chữ trong một ảnh — CHỈ CHẠY Ở MÁY CHỦ.
 *
 * Tầng này không biết ảnh của ngân hàng nào. Nó nhận ảnh, trả chữ thô đúng
 * như Tesseract đọc, kể cả rác ở viền điện thoại. Tách nghĩa ra object là
 * việc của `banks/<mã>.ts`, mỗi ngân hàng một bộ nhãn riêng.
 *
 * Cần `tesseract` và gói tiếng Việt trên máy chạy:
 *   macOS   brew install tesseract tesseract-lang
 *   Alpine  apk add tesseract-ocr tesseract-ocr-data-vie
 * Thiếu thì hàm ném lỗi chứ không trả chuỗi rỗng.
 */

/** Cạnh dài đưa vào Tesseract. Kho ảnh đã ép về 1600, ảnh nhỏ hơn thì giữ nguyên. */
const MAX_EDGE = 1600;

/**
 * `--psm 6`: coi cả ảnh là một khối chữ, mỗi hàng một dòng. Màn hình app là
 * các cặp "nhãn: giá trị" xếp hàng, chế độ này giữ nhãn và giá trị chung dòng,
 * còn chế độ tự dò bố cục hay tách chúng thành hai cột rời.
 */
const PSM = "6";

/**
 * Chữ của HAI lượt đọc nối nhau: ảnh gốc trước, ảnh xám đảo màu sau.
 *
 * Tesseract chỉ đọc tốt chữ tối trên nền sáng. Màn mở tài khoản TPBank là
 * chữ tối nền trắng, ảnh gốc đọc 6/6; màn hình chính là chữ trắng nền tím,
 * ảnh gốc mất trọn tên khách và số tài khoản, đảo màu mới đọc được. Nhưng đảo
 * màu cả ảnh mở tài khoản thì chỉ còn 2/6 (đo 2026-09-11). Không có một bước
 * tiền xử lý đúng cho cả hai, nên đọc hai lượt và nối lại. Parser lấy dòng
 * khớp đầu tiên, lượt gốc đứng trước nên thắng khi nó đọc được.
 *
 * Giá: hai lần thời gian, khoảng 1,1 giây một ảnh trên máy chủ.
 */
export async function ocrImage(image: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mgst-ocr-"));
  try {
    // Tesseract không đọc WebP, mà kho ảnh lưu WebP. Đổi sang PNG không mất
    // chất lượng, kèm thu về MAX_EDGE cho ảnh gốc từ ngoài kho.
    const base = sharp(image).resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
    const plain = path.join(dir, "plain.png");
    const negated = path.join(dir, "negated.png");
    await Promise.all([
      base.clone().png().toFile(plain),
      base.clone().grayscale().negate().png().toFile(negated),
    ]);

    const [a, b] = await Promise.all([tesseract(plain), tesseract(negated)]);
    return `${a}\n${b}`.trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function tesseract(png: string): Promise<string> {
  // Tên file ra không có đuôi: Tesseract tự thêm `.txt`.
  const out = `${png}.out`;
  await run("tesseract", [png, out, "-l", "vie", "--psm", PSM]);
  return (await readFile(`${out}.txt`, "utf8")).trim();
}
