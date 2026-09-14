/**
 * Đo KHỐI MÀU LIỀN LỚN NHẤT của mỗi ảnh, để chọn ngưỡng nhận màn trước khi OCR.
 *
 *   bun .claude/skills/ocr-screen-parser/scripts/color-blob.ts "<thư mục màn cần nhận>" "<thư mục màn khác>" \
 *     --hue 240-268 [--sat 0.35] [--val 0.2]
 *
 * In mỗi ảnh ba số: diện tích khối / diện tích ảnh, chiều cao và chiều rộng
 * khung bao của khối theo tỉ lệ ảnh. Cuối cùng in thấp nhất của thư mục đầu
 * và cao nhất của các thư mục sau: khoảng cách giữa hai số đó là biên an toàn.
 *
 * Cách đo giống `src/server/ocr/screen.ts`: thu ảnh về 240px, đánh dấu điểm
 * đúng màu, giãn 2 điểm để chữ và icon không cắt khối, rồi tìm thành phần
 * liên thông lớn nhất. Tổng số điểm màu và dải hàng liền không tách được màn
 * hình chính TPBank, đừng đo lại hai cách đó.
 */
import sharp from "sharp";
import { readdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const dirs = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const opt = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
if (!dirs.length) {
  console.log("Cách dùng: color-blob.ts <thư mục đúng> [<thư mục khác>...] --hue 240-268 [--sat 0.35] [--val 0.2]");
  process.exit(1);
}
const [hueLo, hueHi] = opt("--hue", "240-268").split("-").map(Number);
const satMin = Number(opt("--sat", "0.35"));
const valMin = Number(opt("--val", "0.2"));
const SAMPLE_WIDTH = 240;

function isTarget(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  if (v < valMin || s < satMin) return false;
  const d = max - min || 1;
  let h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return h >= hueLo && h <= hueHi;
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let dy = -2; dy <= 2 && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            on = 1;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

type Blob = { area: number; height: number; width: number };

function largestBlob(mask: Uint8Array, width: number, height: number): Blob {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  let best: Blob = { area: 0, height: 0, width: 0 };
  let bestCount = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let count = 0;
    let minY = height;
    let maxY = 0;
    let minX = width;
    let maxX = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      const y = Math.floor(p / width);
      const x = p - y * width;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q < 0 || q >= mask.length || seen[q] || !mask[q]) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (count > bestCount) {
      bestCount = count;
      best = { area: count / mask.length, height: (maxY - minY + 1) / height, width: (maxX - minX + 1) / width };
    }
  }
  return best;
}

async function measure(file: string): Promise<Blob> {
  const { data, info } = await sharp(file).rotate().resize({ width: SAMPLE_WIDTH }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let p = 0; p < mask.length; p++) mask[p] = isTarget(data[p * 3], data[p * 3 + 1], data[p * 3 + 2]) ? 1 : 0;
  return largestBlob(dilate(mask, info.width, info.height), info.width, info.height);
}

const fmt = (b: Blob) => `${b.area.toFixed(3)} h=${b.height.toFixed(2)} w=${b.width.toFixed(2)}`;
let positiveMin: Blob | null = null;
let negativeMax: Blob | null = null;
for (const [k, dir] of dirs.entries()) {
  console.log(`\n== ${dir}`);
  for (const f of (await readdir(dir)).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).sort()) {
    const b = await measure(path.join(dir, f));
    console.log(`${fmt(b)}  ${f}`);
    if (k === 0) {
      if (!positiveMin || b.area < positiveMin.area) positiveMin = b;
    } else if (!negativeMax || b.area > negativeMax.area) negativeMax = b;
  }
}
if (positiveMin) console.log(`\nThư mục đúng, khối nhỏ nhất: ${fmt(positiveMin)}`);
if (negativeMax) console.log(`Thư mục khác, khối lớn nhất: ${fmt(negativeMax)}`);
