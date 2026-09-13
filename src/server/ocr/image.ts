import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp, { type Sharp } from "sharp";

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
 * Chữ của BỐN lượt đọc nối nhau, mỗi lượt cho một kiểu ảnh khác nhau.
 *
 * Tesseract chỉ đọc tốt chữ tối trên nền sáng. Màn mở tài khoản TPBank là
 * chữ tối nền trắng, ảnh gốc đọc 6/6; màn hình chính là chữ trắng nền tím,
 * ảnh gốc mất trọn tên khách và số tài khoản, đảo màu mới đọc được. Nhưng đảo
 * màu cả ảnh mở tài khoản thì chỉ còn 2/6 (đo 2026-09-11). Không có một bước
 * tiền xử lý đúng cho mọi ảnh, nên đọc nhiều lượt và nối lại. Parser lấy dòng
 * khớp đầu tiên, lượt gốc đứng trước nên thắng khi nó đọc được.
 *
 * Lượt kênh đỏ cho chữ MÀU trên nền sáng: dòng "Chuyển thành công!" xanh lá
 * trên nền hoa văn, ảnh chụp bằng máy khác thì hai lượt trên đều bỏ qua (đo
 * 2026-09-12). Ở kênh đỏ, chữ xanh lá có giá trị thấp nên thành chữ tối, còn
 * nền trắng và hoa văn tím nhạt có giá trị cao nên mờ đi.
 *
 * Lượt `sharp` cho ảnh CHỤP LẠI màn hình bằng máy khác: chữ nhoè và nhỏ hơn
 * screenshot, ba lượt trên đọc ra rỗng trường (đo 2026-09-13, ảnh TPBank chụp
 * ngoài trời có bóng loá). Phóng to rồi làm nét thì đọc ra đủ mã giới thiệu,
 * số tài khoản và ngày hiệu lực.
 *
 * Giá: bốn lần thời gian, khoảng 2,3 giây một ảnh trên máy chủ.
 */

/**
 * Cạnh dài của lượt `sharp`. `MAX_EDGE` chỉ THU ảnh lớn, không phóng ảnh nhỏ,
 * mà ảnh chụp lại màn hình thường dưới 1600px.
 */
const SHARP_EDGE = 2600;

/** Các lượt tiền xử lý; tên chỉ dùng khi đo, không vào kết quả. */
const VARIANTS: Record<string, (image: Sharp) => Sharp> = {
  plain: (image) => image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }),
  negated: (image) =>
    image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).grayscale().negate(),
  red: (image) =>
    image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).extractChannel("red"),
  sharp: (image) =>
    image.resize({ width: SHARP_EDGE, fit: "inside" }).grayscale().normalise().sharpen({ sigma: 4, m1: 1, m2: 3 }),
};

const DEFAULT_PASSES = ["plain", "negated", "red", "sharp"];

/** Đổi bộ lượt đọc khi ĐO; để trống thì dùng `DEFAULT_PASSES`. */
const passes = (): string[] => (process.env.OCR_PASSES || DEFAULT_PASSES.join(",")).split(",").filter(Boolean);

export async function ocrImage(image: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mgst-ocr-"));
  try {
    // Tesseract không đọc WebP, mà kho ảnh lưu WebP. Đổi sang PNG không mất chất lượng.
    const names = passes();
    const files = names.map((name) => path.join(dir, `${name}.png`));
    await Promise.all(names.map((name, at) => VARIANTS[name](sharp(image)).png().toFile(files[at])));
    const texts = await Promise.all(files.map(tesseract));
    return texts.join("\n").trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Thư mục chứa `vie.traineddata`, theo thứ tự: `TESSDATA_DIR`, rồi `.tessdata`
 * cạnh mã nguồn, rồi bản của hệ điều hành.
 *
 * Bản của hệ điều hành là bản rút gọn — Homebrew 531 KB, Alpine tương tự — và
 * đọc ảnh chụp lại màn hình kém. Bản `tessdata_best` 12,4 MB đọc tốt hơn.
 * Dockerfile tải nó vào `/app/.tessdata`; máy local chạy `scripts/setup-tessdata.sh`.
 */
const TESSDATA_LOCAL = path.join(process.cwd(), ".tessdata");

const tessdataDir = (): string => {
  if (process.env.TESSDATA_DIR) return process.env.TESSDATA_DIR;
  return existsSync(path.join(TESSDATA_LOCAL, "vie.traineddata")) ? TESSDATA_LOCAL : "";
};

const tessdataArgs = (): string[] => {
  const dir = tessdataDir();
  return dir ? ["--tessdata-dir", dir] : [];
};

async function tesseract(png: string): Promise<string> {
  // Tên file ra không có đuôi: Tesseract tự thêm `.txt`.
  const out = `${png}.out`;
  await run("tesseract", [png, out, "-l", "vie", "--psm", PSM, ...tessdataArgs()]);
  return (await readFile(`${out}.txt`, "utf8")).trim();
}
