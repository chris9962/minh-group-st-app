/**
 * Tải giấy chứng nhận PDF của một đơn từ PVI, rồi đổi sang ảnh PNG.
 *
 * Dùng cho LUỒNG 3 — xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`. Luồng đó
 * chạy sau khi đơn đã duyệt xong bên PVI: PVI không sinh file ngay lúc duyệt,
 * nên phải hỏi đi hỏi lại cho tới khi file xuất hiện.
 *
 * Đổi PDF sang ảnh vì `insurance_orders.certificate_photo_url` lưu KHOÁ ẢNH, và
 * cả đường xem ảnh (`/api/images/<key>`) lẫn kho lưu trữ đều chỉ nhận ảnh.
 *
 * Ra WebP, cùng định dạng với ảnh người dùng tải lên (`src/lib/toWebpImage.ts`).
 * Hàm đó chạy bằng `canvas.toBlob` của TRÌNH DUYỆT nên worker không gọi lại
 * được; ở đây dùng `cwebp` với cùng chất lượng và cùng giới hạn cạnh.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const BASE_URL = process.env.PVI_BASE_URL?.replace(/\/+$/, "") ?? "https://qlcd.pvi.com.vn";

/**
 * Đường dẫn tới cookie phiên PVI, cùng file bot tạo đơn dùng.
 *
 * Hết phiên thì PVI trả màn hình đăng nhập chứ không trả 401, nên hàm dưới nhận
 * ra bằng cách xem nội dung có phải PDF không.
 */
const STATE_PATH =
  process.env.PVI_STATE ?? path.join(process.cwd(), "pvi-qlcd-playwright", "storageState.json");

/**
 * Tham số `type` của `/Service/DownloadFile`.
 *
 * `3` là giá trị thấy trên đường dẫn PVI dựng ở giao diện. Bốn giá trị khác đã
 * thử đều trả cùng trang HTML "File trên hệ thống đã bị xóa", nên chưa phân biệt
 * được `type` nào ứng với loại file nào. Đổi bằng biến môi trường thay vì sửa code.
 */
const FILE_TYPE = process.env.PVI_CERTIFICATE_TYPE ?? "3";

/** Ngưỡng ảnh của kho lưu trữ là 10MB; 150 DPI cho một trang A4 khoảng 1–2MB. */
const RENDER_DPI = process.env.PVI_CERTIFICATE_DPI ?? "150";

/** Khớp `src/lib/toWebpImage.ts`: chất lượng 0.8, cạnh dài nhất 1600px. */
const WEBP_QUALITY = "80";
const MAX_EDGE = "1600";

export type CertificateDownload =
  /** PVI đã sinh file. */
  | { ready: true; pdf: Buffer }
  /** Chưa có file, hoặc phiên đăng nhập hết hạn. Thử lại vòng sau. */
  | { ready: false; reason: string };

const isPdf = (bytes: Buffer): boolean => bytes.subarray(0, 5).toString("latin1") === "%PDF-";

type StoredCookie = { name: string; value: string; domain: string };

/** Dựng header `Cookie` từ file phiên mà bot đăng nhập đã lưu. */
async function cookieHeader(): Promise<string> {
  const raw = await readFile(STATE_PATH, "utf8");
  const state = JSON.parse(raw) as { cookies?: StoredCookie[] };
  const host = new URL(BASE_URL).hostname;
  return (state.cookies ?? [])
    .filter((c) => host === c.domain || host.endsWith(c.domain.replace(/^\./, ".")))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/**
 * Hỏi PVI xem đơn này đã có giấy chứng nhận chưa.
 *
 * Không mở trình duyệt: đây là một lượt HTTP kèm cookie phiên. Bỏ Chromium để
 * luồng 3 chạy được trên máy chủ không có màn hình mà không cần Xvfb.
 *
 * Dùng `fetch` chứ KHÔNG dùng `request` của Playwright. Đo 2026-08-23: PVI trả
 * `200 application/pdf` kèm `set-cookie: BNI_persistence=...; Path=/`, và
 * `_parseSetCookieHeader` của playwright-core ném `TypeError ... cannot be
 * parsed as a URL` trên đúng header đó — response không bao giờ đọc xong, lượt
 * gọi treo tới hết thời gian chờ.
 */
export async function downloadCertificate(prKey: string): Promise<CertificateDownload> {
  if (!prKey) return { ready: false, reason: "Đơn chưa có pr_key" };

  const url = `${BASE_URL}/Service/DownloadFile?id=${encodeURIComponent(prKey)}&type=${FILE_TYPE}`;
  try {
    const res = await fetch(url, {
      headers: { cookie: await cookieHeader() },
      signal: AbortSignal.timeout(60_000),
      redirect: "follow",
    });
    if (!res.ok) return { ready: false, reason: `PVI trả HTTP ${res.status}` };

    const body = Buffer.from(await res.arrayBuffer());
    if (isPdf(body)) return { ready: true, pdf: body };

    // PVI trả trang HTML khi chưa có file — "File trên hệ thống đã bị xóa" — và
    // trả màn hình đăng nhập khi hết phiên. Cả hai đều là "chưa lấy được", nhưng
    // hai lý do khác nhau nên người đọc log phải phân biệt được.
    const text = body.toString("utf8");
    const hetPhien = text.includes("login-username") || text.includes("Capcha1.aspx");
    return {
      ready: false,
      reason: hetPhien ? "Phiên đăng nhập PVI hết hạn" : "PVI chưa sinh file",
    };
  } catch (e) {
    return { ready: false, reason: `Không gọi được PVI: ${(e as Error).message}` };
  }
}

/**
 * Đổi TRANG ĐẦU của PDF sang một ảnh WebP.
 *
 * Chỉ trang đầu (chốt 2026-08-23): giấy chứng nhận PVI đo được đều một trang, và
 * trang đầu mang đủ thông tin người xem cần. Trang sau nếu có là điều khoản in
 * kèm, không phải nội dung riêng của đơn.
 *
 * Cần hai công cụ trên máy chạy: `pdftoppm` của poppler và `cwebp` của libwebp.
 * macOS: `brew install poppler webp`. Debian: `apt install poppler-utils webp`.
 * Thiếu một trong hai thì hàm ném lỗi chứ không trả ảnh rỗng.
 */
export async function pdfToWebp(pdf: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "pvi-cert-"));
  try {
    const src = path.join(dir, "in.pdf");
    const pngPath = path.join(dir, "trang1.png");
    const webpPath = path.join(dir, "trang1.webp");
    await writeFile(src, pdf);

    // `-f 1 -l 1` giới hạn đúng trang đầu; `-singlefile` bỏ hậu tố `-1` mà
    // pdftoppm vốn thêm vào tên file, nên đường dẫn dưới đây đọc được ngay.
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
