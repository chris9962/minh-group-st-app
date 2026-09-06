import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { putImage } from "../storage";

/**
 * Tải file PDF giấy chứng nhận PVI cấp, đổi trang đầu sang WebP, đẩy lên kho.
 *
 * KHÔNG lưu địa chỉ file của PVI vào database (chốt 2026-09-03). Địa chỉ đó
 * mang `CpId` và một chữ ký ngay trong tham số, dạng
 * `.../Home/ViewPolicy?p=<số GCN>&cpid=<CpId>&sign=<md5>&r=<mã giao dịch>`.
 * Lưu lại rồi hiện cho nhân viên là lộ `CpId` cho mọi người mở được đơn.
 *
 * Kết quả cuối là KHOÁ ảnh trong kho, ghi vào `insurance_orders.certificate_photo_url`
 * — cùng cột và cùng định dạng với ảnh bot Playwright chụp về, nên màn hình đọc
 * một đường duy nhất.
 *
 * Đây là bản của đường API. Bot có bản riêng ở
 * `pvi-qlcd-playwright/lib/certificate.ts`: bot tải qua `/Service/DownloadFile`
 * bằng phiên đăng nhập, còn đường này tải thẳng từ địa chỉ PVI trả về. Hai file
 * đứng riêng vì `pvi-qlcd-playwright/` là công cụ tách rời mgst-app.
 */

const run = promisify(execFile);

/** Ngưỡng ảnh của kho lưu trữ là 20MB; 150 DPI cho một trang A4 khoảng 1–2MB. */
const RENDER_DPI = process.env.PVI_CERTIFICATE_DPI ?? "150";

/** Khớp `src/lib/toWebpImage.ts`: chất lượng 0.8, cạnh dài nhất 1600px. */
const WEBP_QUALITY = "80";
const MAX_EDGE = "1600";

const DOWNLOAD_TIMEOUT_MS = 30_000;

const isPdf = (bytes: Buffer): boolean => bytes.subarray(0, 5).toString("latin1") === "%PDF-";

/**
 * Đổi TRANG ĐẦU của PDF sang một ảnh WebP.
 *
 * Chỉ trang đầu: giấy chứng nhận PVI đo được đều một trang, và trang đầu mang đủ
 * thông tin người xem cần.
 *
 * Cần hai công cụ trên máy chạy: `pdftoppm` của poppler và `cwebp` của libwebp.
 * macOS: `brew install poppler webp`. Debian: `apt install poppler-utils webp`.
 * Thiếu một trong hai thì hàm ném lỗi chứ không trả ảnh rỗng.
 */
export async function pdfToWebp(pdf: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "pvi-api-cert-"));
  try {
    const src = path.join(dir, "in.pdf");
    const pngPath = path.join(dir, "trang1.png");
    const webpPath = path.join(dir, "trang1.webp");
    await writeFile(src, pdf);

    // `-f 1 -l 1` giới hạn đúng trang đầu; `-singlefile` bỏ hậu tố `-1` mà
    // pdftoppm vốn thêm vào tên file.
    await run("pdftoppm", [
      "-png",
      "-r",
      RENDER_DPI,
      "-f",
      "1",
      "-l",
      "1",
      "-singlefile",
      src,
      path.join(dir, "trang1"),
    ]);

    // `-resize 1600 0` giữ tỉ lệ và chỉ thu nhỏ khi ảnh rộng hơn 1600px.
    await run("cwebp", ["-q", WEBP_QUALITY, "-resize", MAX_EDGE, "0", pngPath, "-o", webpPath]);
    return readFile(webpPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type CertificateResult =
  | { ok: true; photoKey: string }
  /** `pviFault` = lỗi bên PVI, đáng tăng số lần thử. `false` = lỗi ở máy mình. */
  | { ok: false; pviFault: boolean; reason: string };

/**
 * Tải một địa chỉ giấy chứng nhận rồi lưu ảnh vào kho.
 *
 * Phân biệt lỗi bên PVI với lỗi bên mình là bắt buộc: nơi gọi tăng
 * `certificate_attempts` cho lỗi của PVI, còn lỗi của mình thì không — hết
 * `pdftoppm` hay kho ảnh đầy mà cứ cộng thì đơn chạm ngưỡng rồi bị bỏ, dù PVI
 * đã cấp giấy chứng nhận từ lâu.
 */
export async function saveCertificateFrom(
  url: string,
  orderCode: string,
): Promise<CertificateResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, pviFault: true, reason: `không tải được file: ${reason}` };
  }

  if (!response.ok)
    return { ok: false, pviFault: true, reason: `file trả HTTP ${response.status}` };

  const bytes = Buffer.from(await response.arrayBuffer());

  // PVI trả trang HTML thay vì PDF khi file chưa sinh xong, giống hệt đường của
  // bot. Kiểm bằng nội dung chứ không bằng `content-type`.
  if (!isPdf(bytes)) return { ok: false, pviFault: true, reason: "PVI chưa sinh file PDF" };

  let webp: Buffer;
  try {
    webp = await pdfToWebp(bytes);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, pviFault: false, reason: `không đổi được PDF sang ảnh: ${reason}` };
  }

  const file = new File([new Uint8Array(webp)], `${orderCode}.webp`, { type: "image/webp" });
  const put = await putImage(file, "insurance-certificates");
  if (!put.ok) return { ok: false, pviFault: false, reason: `không đẩy được ảnh: ${put.message}` };

  return { ok: true, photoKey: put.key };
}
