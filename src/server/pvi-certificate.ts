/**
 * Tải giấy chứng nhận PDF của một đơn từ PVI, rồi đổi sang ảnh PNG.
 *
 * Dùng cho LUỒNG 3 — xem `pvi-qlcd-playwright/LUONG-TAO-VA-DUYET.md`. Luồng đó
 * chạy sau khi đơn đã duyệt xong bên PVI: PVI không sinh file ngay lúc duyệt,
 * nên phải hỏi đi hỏi lại cho tới khi file xuất hiện.
 *
 * Đổi PDF sang ảnh vì `insurance_orders.certificate_photo_url` lưu KHOÁ ẢNH, và
 * cả đường xem ảnh (`/api/images/<key>`) lẫn kho lưu trữ đều chỉ nhận ảnh.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
 * Đổi PDF sang MỘT ảnh PNG. Nhiều trang thì xếp dọc rồi ghép làm một.
 *
 * Ghép chứ không lấy trang đầu: `certificate_photo_url` chỉ giữ được một khoá,
 * mà bỏ trang sau là bỏ nội dung hợp đồng.
 *
 * Cần `pdftoppm` của poppler trên máy chạy (`brew install poppler`,
 * `apt install poppler-utils`). Thiếu nó thì hàm ném lỗi chứ không trả ảnh rỗng.
 */
export async function pdfToPng(pdf: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "pvi-cert-"));
  try {
    const src = path.join(dir, "in.pdf");
    await writeFile(src, pdf);
    await run("pdftoppm", ["-png", "-r", RENDER_DPI, src, path.join(dir, "page")]);

    const pages = (await readdir(dir))
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .sort();
    if (!pages.length) throw new Error("pdftoppm không xuất được trang nào");

    const buffers = await Promise.all(pages.map((f) => readFile(path.join(dir, f))));
    return buffers.length === 1 ? buffers[0] : stackVertically(buffers);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Ghép nhiều PNG thành một, xếp dọc.
 *
 * Dựng bằng Chromium của Playwright thay vì thêm thư viện xử lý ảnh: Playwright
 * đã là phụ thuộc sẵn có, còn `sharp` hay ImageMagick thì phải cài thêm trên
 * mọi máy chạy.
 */
async function stackVertically(pages: Buffer[]): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const imgs = pages
      .map((b) => `<img src="data:image/png;base64,${b.toString("base64")}">`)
      .join("");
    await page.setContent(
      `<body style="margin:0;background:#fff">
         <div style="display:flex;flex-direction:column">${imgs}</div>
       </body>`,
      { waitUntil: "load" },
    );
    const el = page.locator("div").first();
    return await el.screenshot({ type: "png" });
  } finally {
    await browser.close().catch(() => {});
  }
}
