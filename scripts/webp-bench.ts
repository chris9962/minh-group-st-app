/**
 * Đo mức giảm dung lượng của `toWebpImage` (spec §U7).
 *
 * Chạy ĐÚNG hàm dùng thật, không chép lại thuật toán: `Bun.build` gói
 * `src/lib/toWebpImage.ts` rồi Playwright nạp vào một trang Chromium trống.
 * `canvas.toBlob` là API trình duyệt nên không có cách đo nào khác ngoài mở
 * trình duyệt thật.
 *
 *   bun run webp:bench                  → đo mọi ảnh trong scripts/webp-samples
 *   bun run webp:bench <đường dẫn…>     → đo đúng những file đó
 */

import { chromium } from "playwright";

/**
 * Khai kiểu tại chỗ cho `Bun.build`.
 *
 * KHÔNG cài `@types/bun`: nó ghi đè kiểu `fetch` toàn cục và làm `tsc` gãy ở
 * `providers.tsx` (đã ghi ở `mgst-decisions-log.md`, mục 07/08). Script trong
 * `scripts/` vẫn được `tsc` soi như code ứng dụng, nên thiếu khai báo này là
 * `tsc` không chạy được.
 */
declare const Bun: {
  build(options: {
    entrypoints: string[];
    target: "browser" | "bun" | "node";
    format: "iife" | "esm" | "cjs";
  }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
};
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function listImages(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listImages(path)));
    else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * KHÔNG lấy mặc định là `public/uploads`. Sau U7 thư mục đó toàn ảnh WebP do
 * chính `toWebpImage` sinh ra, nên đo lại chỉ ra mức giảm gần bằng không.
 * Mẫu phải là ảnh gốc từ máy ảnh hoặc điện thoại.
 */
const SAMPLE_DIR = "scripts/webp-samples";

const args = process.argv.slice(2);
const files = args.length > 0 ? args : await listImages(SAMPLE_DIR).catch(() => []);
if (files.length === 0) {
  console.log(
    args.length > 0
      ? "Không có ảnh nào để đo."
      : `Không có ảnh nào trong ${SAMPLE_DIR}. Chép ảnh gốc vào đó, hoặc truyền đường dẫn file.`,
  );
  process.exit(0);
}

const built = await Bun.build({
  entrypoints: ["src/lib/toWebpImage.ts"],
  target: "browser",
  format: "iife",
});
if (!built.success) {
  console.error(built.logs);
  process.exit(1);
}
/**
 * Bản gói `iife` giữ mọi thứ trong phạm vi riêng, không có gì ra ngoài. Chèn
 * một dòng gán vào `globalThis` ngay TRƯỚC dấu đóng của nó — đứng sau thì hàm
 * đã ra khỏi phạm vi.
 */
const raw = await built.outputs[0].text();
const close = raw.lastIndexOf("})();");
const bundle = `${raw.slice(0, close)}  globalThis.toWebpImage = toWebpImage;\n${raw.slice(close)}`;

const browser = await chromium.launch();

let totalBefore = 0;
let totalAfter = 0;
let keptOriginal = 0;

// Hỏng giữa chừng vẫn phải đóng, không thì tiến trình Chromium nằm lại.
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>webp bench</title>");
  await page.addScriptTag({ content: bundle });

  console.log(
    `${"ảnh".padEnd(46)} ${"trước".padStart(9)} ${"sau".padStart(9)} ${"giảm".padStart(7)}`,
  );

  for (const path of files) {
    const bytes = await readFile(path);
    const size = (await stat(path)).size;
    const type = path.toLowerCase().endsWith(".png")
      ? "image/png"
      : path.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    /**
     * Đưa ảnh sang trang bằng base64, không bằng mảng số. `Array.from(bytes)` đẩy
     * mỗi byte thành một phần tử JSON: một file 5,3MB mất 14 giây và 30 ảnh điện
     * thoại là hết bộ nhớ.
     */
    const result = await page.evaluate(
      async ({ base64, name, type }) => {
        const binary = atob(base64);
        const data = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
        const file = new File([data], name, { type });
        // @ts-expect-error hàm gắn vào window ở trên
        const out = await window.toWebpImage(file);
        return { size: out.size, type: out.type, name: out.name };
      },
      { base64: bytes.toString("base64"), name: path.split("/").pop()!, type },
    );

    const converted = result.type === "image/webp";
    if (!converted) keptOriginal += 1;
    totalBefore += size;
    totalAfter += result.size;

    const drop = converted ? `${(100 - (result.size / size) * 100).toFixed(0)}%` : "giữ gốc";
    console.log(
      `${path.slice(-46).padEnd(46)} ${kb(size).padStart(9)} ${kb(result.size).padStart(9)} ${drop.padStart(7)}`,
    );
  }
} finally {
  await browser.close();
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log("─".repeat(76));
console.log(`${files.length} ảnh · ${keptOriginal} ảnh giữ nguyên bản`);
console.log(
  `Tổng: ${mb(totalBefore)} → ${mb(totalAfter)} · giảm ${(100 - (totalAfter / totalBefore) * 100).toFixed(1)}%`,
);
