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
 * Chữ của BỐN lượt đọc nối nhau ở profile mặc định, mỗi lượt cho một kiểu ảnh.
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

/**
 * Cạnh dài cho ảnh CHỤP LẠI màn hình bằng máy khác ở lượt `tpbHome`: màn hình
 * chỉ chiếm một phần khung nên chữ nhỏ, phải phóng. Screenshot thì giữ
 * `MAX_EDGE`: phóng screenshot làm Tesseract đọc sai tên (đo 2026-09-14).
 */
const PHOTO_EDGE = 2600;

/** Ảnh chụp lại bằng máy khác có tỉ lệ cạnh ngắn/cạnh dài > 0,6; screenshot điện thoại khoảng 0,45. */
const isPhoto = (width: number, height: number): boolean => Math.min(width, height) / Math.max(width, height) > 0.6;

/**
 * Điện thoại nằm ngang trong ảnh chụp thì Tesseract không đọc được; hỏi
 * hướng bằng `--psm 0` (0,3 giây, không phải một lượt OCR) rồi xoay theo.
 * Hỏi trên bản phóng 2600, không hỏi trên ảnh gốc: ảnh 1200x900 hỏi trên
 * gốc trả 90° sai, trên bản 2600 trả 270° đúng (tài khoản 32acce88,
 * 2026-09-15); ảnh 1400px thì bản gốc báo "Too few characters".
 *
 * `--psm 0` không trả lời được thì không xoay là chắc chắn sai: app chỉ có
 * bố cục dọc, điện thoại nằm ngang trong ảnh là 90° hoặc 270°. Khi đó đọc
 * thử hai hướng ở cỡ 1200 bằng `eng` `--psm 11` (0,3 giây một lượt) và lấy
 * hướng ra nhiều chữ số và chữ cái hơn.
 */
async function rotationOf(image: Sharp, dir: string): Promise<number> {
  const png = path.join(dir, "osd.png");
  await image.clone().png().toFile(png);
  try {
    const { stdout } = await run("tesseract", [png, "-", "--psm", "0"]);
    const angle = Number(stdout.match(/Rotate: (\d+)/)?.[1] ?? 0);
    if (angle) return angle;
  } catch {
    // Rơi xuống đọc thử hai hướng.
  }
  const score = async (angle: number): Promise<number> => {
    const probe = path.join(dir, `rot${angle}.png`);
    await image.clone().rotate(angle).resize({ width: 1200, fit: "inside" }).png().toFile(probe);
    const { stdout } = await run("tesseract", [probe, "-", "-l", "eng", "--psm", "11"]).catch(() => ({ stdout: "" }));
    return stdout.replace(/[^A-Za-z0-9]/g, "").length;
  };
  return (await score(270)) >= (await score(90)) ? 270 : 90;
}

/** Góc phải xoay: 0 cho ảnh dọc, còn ảnh ngang dò trên bản phóng 2600. */
async function landscapeRotation(image: Sharp, dir: string): Promise<number> {
  const { width = 0, height = 0 } = await image.metadata();
  if (width <= height) return 0;
  return rotationOf(image.clone().resize({ width: PHOTO_EDGE, fit: "inside" }), dir);
}

/**
 * Góc xoay nhớ theo từng ảnh: một tài khoản đọc cùng ảnh bằng nhiều profile
 * nối tiếp, dò lại ở mỗi lượt thì ảnh ngang dò thất bại tốn 3 lượt Tesseract
 * mỗi lần (tài khoản 32acce88: 39 giây, đo 2026-09-15). `WeakMap` theo Buffer
 * nên không giữ ảnh sau khi lượt kiểm xong.
 */
const ROTATION = new WeakMap<Buffer, Promise<number>>();

const rotationFor = (image: Buffer, dir: string) => (): Promise<number> => {
  let angle = ROTATION.get(image);
  if (!angle) {
    angle = landscapeRotation(sharp(image), dir);
    ROTATION.set(image, angle);
  }
  return angle;
};

/** Ảnh ngang thì xoay theo hướng đã dò; ảnh dọc giữ nguyên. */
async function upright(image: Sharp, rotation: () => Promise<number>): Promise<Sharp> {
  const angle = await rotation();
  return angle ? image.rotate(angle) : image;
}

type Variant = (image: Sharp, dir: string, rotation: () => Promise<number>) => Sharp | Promise<Sharp>;

/** Các lượt tiền xử lý; tên chỉ dùng khi đo, không vào kết quả. */
const VARIANTS: Record<string, Variant> = {
  plain: (image) => image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }),
  negated: (image) =>
    image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).grayscale().negate(),
  red: (image) =>
    image.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true }).extractChannel("red"),
  sharp: (image) =>
    image.resize({ width: SHARP_EDGE, fit: "inside" }).grayscale().normalise().sharpen({ sigma: 4, m1: 1, m2: 3 }),
  /**
   * Màn hình chính TPBank: chữ trắng trên nền tím. Lấy kênh xanh lá rồi đảo:
   * nền tím có xanh lá thấp thành sáng, chữ trắng thành đen, tương phản cao
   * hơn chuyển xám rồi đảo (đo 2026-09-14 trên 63 ảnh: STK 61/63, tên 62/63).
   */
  tpbHome: async (image, _dir, rotation) => {
    const { width = 0, height = 0 } = await image.metadata();
    const fit = isPhoto(width, height)
      ? { width: PHOTO_EDGE, fit: "inside" as const }
      : { width: MAX_EDGE, height: MAX_EDGE, fit: "inside" as const, withoutEnlargement: true };
    return (await upright(image, rotation)).resize(fit).extractChannel("green").negate();
  },
  /** Màn chuyển khoản: kênh đỏ như `red`, thêm xoay ảnh ngang. */
  tpbTransfer: async (image, _dir, rotation) =>
    (await upright(image, rotation))
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .extractChannel("red"),
  tpbLight: (image, _dir, rotation) => tpbLightBase(image, rotation, true),
  tpbLightSharp: async (image, _dir, rotation) =>
    (await tpbLightBase(image, rotation, true)).grayscale().normalise().sharpen({ sigma: 4, m1: 1, m2: 3 }),
  tpbLightUnscaled: (image, _dir, rotation) => tpbLightBase(image, rotation, false),
};

/**
 * Hai màn chữ tối nền sáng của TPBank, "Nhập thông tin để bắt đầu" và "Mở tài
 * khoản thành công": giữ màu gốc, ảnh chụp lại phóng 2600px như `tpbHome`,
 * ảnh ngang xoay theo `upright`.
 */
async function tpbLightBase(image: Sharp, rotation: () => Promise<number>, enlarge: boolean): Promise<Sharp> {
  const { width = 0, height = 0 } = await image.metadata();
  const photo = isPhoto(width, height);
  const fit =
    enlarge && photo
      ? { width: PHOTO_EDGE, fit: "inside" as const }
      : { width: MAX_EDGE, height: MAX_EDGE, fit: "inside" as const, withoutEnlargement: true };
  return (await upright(image, rotation)).resize(fit);
}

const DEFAULT_PASSES = ["plain", "negated", "red", "sharp"];

/**
 * Một cấu hình Tesseract cho một MÀN. Mỗi màn một màu chữ và nền, không có
 * cấu hình chung đọc tốt mọi màn; bộ nhãn ngân hàng chọn profile sau khi nhận
 * ra màn (`screen.ts`).
 */
export type OcrProfile = {
  passes: string[];
  lang: string;
  psm: string;
  /** `true` = dùng model kèm hệ điều hành, bỏ qua `.tessdata` (chỉ có `vie`). */
  osModel?: boolean;
};

/**
 * `--psm 6`: coi cả ảnh là một khối chữ, mỗi hàng một dòng. Màn hình app là
 * các cặp "nhãn: giá trị" xếp hàng, chế độ này giữ nhãn và giá trị chung dòng,
 * còn chế độ tự dò bố cục hay tách chúng thành hai cột rời.
 */
export const DEFAULT_PROFILE: OcrProfile = { passes: DEFAULT_PASSES, lang: "vie", psm: "6" };

/**
 * Màn hình chính TPBank chỉ có tên viết hoa không dấu và chữ số, model `eng`
 * đọc chữ số đúng hơn `vie` và nhanh gấp đôi; `--psm 11` đọc chữ rời rạc, hợp
 * với ảnh chụp lại. Bản `eng` tessdata_best không cao hơn bản gọn (đo 2026-09-14).
 */
export const TPB_HOME_PROFILE: OcrProfile = { passes: ["tpbHome"], lang: "eng", psm: "11", osModel: true };

/**
 * Hai màn chữ tối nền sáng của TPBank dùng chung một lượt đầu, vì trước khi
 * OCR không biết ảnh là màn nào. `plain` + `eng` + `--psm 11`, ảnh chụp phóng
 * 2600px, đo 2026-09-14:
 *
 * - "Nhập thông tin để bắt đầu", 94 ảnh có nhãn: không phóng 85/94 ở 0,36 s,
 *   phóng 2600 lên 89/94 ở 0,49 s; phóng 1400 chỉ 88, 2000 cũng 89. `vie`
 *   `--psm 6` của profile mặc định chỉ 80/94 ở 0,79 s. Lượt `sharp` đọc được
 *   4 ảnh chụp mờ mà `plain` bỏ, nhưng mất 2 ảnh `plain` đọc được, nên chỉ
 *   chạy khi lượt đầu thấy màn mà không thấy mã.
 * - "Mở tài khoản thành công", 74 ảnh có nhãn: đủ mã và số tài khoản 72/74 ở
 *   0,72 s; `vie` `--psm 6` mặc định 66/74; `sharp` 69/74; `--psm 6` 71/74.
 *   Ảnh chụp sát màn hình có vân lưới điểm ảnh thì MỌI cỡ phóng ra rác, kể
 *   cả blur hay median trước khi phóng; chỉ cỡ gốc đọc đúng. Nên lượt hai
 *   của màn này là `tpbLightUnscaled`, chạy khi lượt đầu thiếu trường hoặc
 *   không nhận ra màn nào.
 */
export const TPB_LIGHT_PROFILE: OcrProfile = { passes: ["tpbLight"], lang: "eng", psm: "11", osModel: true };
export const TPB_LIGHT_SHARP_PROFILE: OcrProfile = { passes: ["tpbLightSharp"], lang: "eng", psm: "11", osModel: true };
export const TPB_LIGHT_UNSCALED_PROFILE: OcrProfile = {
  passes: ["tpbLightUnscaled"],
  lang: "eng",
  psm: "11",
  osModel: true,
};

/**
 * Màn "Chuyển thành công" TPBank, đo 2026-09-14 trên 55 ảnh có nhãn: số tiền
 * in đậm trên nền hoa văn và tiêu đề xanh lá làm `eng` `--psm 11` chỉ đọc số
 * tiền 16/55; `vie` `--psm 6` bản `best` đọc 54/55. Kênh đỏ đọc tiêu đề xanh
 * lá 52/55 so với 47/55 của ảnh gốc, và nhanh gấp đôi (0,63 s). Phóng ảnh
 * chụp lên 2600px làm số tiền tụt 54 → 50 nên giữ 1600px. Đủ bốn trường
 * 50/55 một lượt; đọc thêm lượt `sharp` khi thiếu thì 55/55.
 */
export const TPB_TRANSFER_PROFILE: OcrProfile = { passes: ["tpbTransfer"], lang: "vie", psm: "6" };

/** Đổi bộ lượt đọc của profile mặc định khi ĐO; để trống thì giữ nguyên. */
const passesOf = (profile: OcrProfile): string[] =>
  profile === DEFAULT_PROFILE && process.env.OCR_PASSES
    ? process.env.OCR_PASSES.split(",").filter(Boolean)
    : profile.passes;

export async function ocrImage(image: Buffer, profile: OcrProfile = DEFAULT_PROFILE): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mgst-ocr-"));
  try {
    // Tesseract không đọc WebP, mà kho ảnh lưu WebP. Đổi sang PNG không mất chất lượng.
    const names = passesOf(profile);
    const files = names.map((name) => path.join(dir, `${name}.png`));
    const rotation = rotationFor(image, dir);
    await Promise.all(
      names.map(async (name, at) => (await VARIANTS[name](sharp(image), dir, rotation)).png().toFile(files[at])),
    );
    const texts = await Promise.all(files.map((file) => tesseract(file, profile)));
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

const tessdataArgs = (profile: OcrProfile): string[] => {
  const dir = profile.osModel ? "" : tessdataDir();
  return dir ? ["--tessdata-dir", dir] : [];
};

async function tesseract(png: string, profile: OcrProfile): Promise<string> {
  // Tên file ra không có đuôi: Tesseract tự thêm `.txt`.
  const out = `${png}.out`;
  await run("tesseract", [png, out, "-l", profile.lang, "--psm", profile.psm, ...tessdataArgs(profile)]);
  return (await readFile(`${out}.txt`, "utf8")).trim();
}
