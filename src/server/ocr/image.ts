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

export async function ocrImage(image: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mgst-ocr-"));
  try {
    // Tesseract không đọc WebP, mà kho ảnh lưu WebP. Đổi sang PNG không mất
    // chất lượng, kèm thu về MAX_EDGE cho ảnh gốc từ ngoài kho.
    const png = path.join(dir, "in.png");
    await sharp(image)
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .png()
      .toFile(png);

    // Tên file ra không có đuôi: Tesseract tự thêm `.txt`.
    const out = path.join(dir, "out");
    await run("tesseract", [png, out, "-l", "vie", "--psm", PSM]);
    return (await readFile(`${out}.txt`, "utf8")).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
