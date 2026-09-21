/**
 * Ghép ảnh thành tấm để KIỂM NHÃN bằng mắt: 4 ảnh một tấm, mỗi ảnh kèm tên
 * file, cắt phần trên màn hình nơi tên và số thường nằm.
 *
 *   bun .claude/skills/ocr-verify/scripts/verify-sheet.ts "<thư mục ảnh>" /tmp/vs \
 *     [--top 0.2] [--photo-top 0.55] [--only photo|shot] [--width 460] [--per 4]
 *
 * Ra các file `/tmp/vs-01.jpg`, `/tmp/vs-02.jpg`, ... Đọc từng tấm bằng `Read`.
 * `--top` là phần chiều cao giữ lại của screenshot; `--photo-top` của ảnh chụp
 * lại bằng máy khác, để rộng hơn vì không biết điện thoại nằm đâu trong khung.
 * Màn có trường ở giữa ảnh thì `--top 1`; ảnh chụp lại ở cỡ 460 không đọc
 * được mã 5 ký tự, nên tách ra tấm riêng: `--only photo --width 1000 --per 2`.
 *
 * Script phải nằm trong repo: bun nạp `sharp` theo vị trí file, đặt ngoài repo
 * thì nạp bản wasm trong cache và lỗi "Out of bounds memory access".
 */
import sharp from "sharp";
import { readdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const [dir, outPrefix] = args;
const flag = (name: string, fallback: number) => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
if (!dir || !outPrefix) {
  console.log("Cách dùng: verify-sheet.ts <thư mục ảnh> <tiền tố file ra> [--top 0.2] [--photo-top 0.55]");
  process.exit(1);
}
const TOP = flag("--top", 0.2);
const PHOTO_TOP = flag("--photo-top", 0.55);
const W = flag("--width", 460);
const PER = flag("--per", 4);
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1] : "";
const isPhoto = (width: number, height: number) => Math.min(width, height) / Math.max(width, height) > 0.6;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const all = (await readdir(dir)).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).sort();
const files: string[] = [];
for (const f of all) {
  const { width = 0, height = 0 } = await sharp(path.join(dir, f)).metadata();
  if (!only || (only === "photo") === isPhoto(width, height)) files.push(f);
}
for (let i = 0; i < files.length; i += PER) {
  const group = files.slice(i, i + PER);
  const tiles: Buffer[] = [];
  for (const f of group) {
    const img = sharp(path.join(dir, f)).rotate();
    const { width = 0, height = 0 } = await img.metadata();
    const photo = isPhoto(width, height);
    const crop = { left: 0, top: 0, width, height: Math.round(height * (photo ? PHOTO_TOP : TOP)) };
    const body = await img.extract(crop).resize({ width: W }).png().toBuffer();
    const bodyHeight = (await sharp(body).metadata()).height ?? 0;
    const label = Buffer.from(
      `<svg width="${W}" height="34"><rect width="100%" height="100%" fill="#222"/>` +
        `<text x="6" y="23" font-size="15" font-family="Helvetica" fill="#fff">${esc(f.replace(/\.\w+$/, ""))}</text></svg>`,
    );
    tiles.push(
      await sharp({ create: { width: W, height: bodyHeight + 34, channels: 3, background: "#222" } })
        .composite([{ input: label, top: 0, left: 0 }, { input: body, top: 34, left: 0 }])
        .png()
        .toBuffer(),
    );
  }
  const heights = await Promise.all(tiles.map(async (t) => (await sharp(t).metadata()).height ?? 0));
  await sharp({ create: { width: (W + 8) * group.length, height: Math.max(...heights), channels: 3, background: "#888" } })
    .composite(tiles.map((input, k) => ({ input, left: k * (W + 8), top: 0 })))
    .jpeg({ quality: 82 })
    .toFile(`${outPrefix}-${String(i / PER + 1).padStart(2, "0")}.jpg`);
}
console.log(`${files.length} ảnh, ${Math.ceil(files.length / PER)} tấm: ${outPrefix}-01.jpg ...`);
