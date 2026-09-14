/**
 * Đo MỘT cấu hình Tesseract, một lượt mỗi ảnh, trên một thư mục ảnh có nhãn.
 *
 *   bun .claude/skills/ocr-screen-parser/scripts/ocr-grid.ts "<thư mục ảnh>" --name gneg-psm11 \
 *     --pre green-neg --psm 11 --lang eng --model os [--size 1600] [--photo-size 2600] [--no-rotate]
 *
 * Nhãn lấy từ `labels.json` trong thư mục (`{ "file.webp": { "customerName": "...", ... } }`),
 * không có thì từ tên file `<ten-khach>-<so-tai-khoan>.webp`.
 *
 * Chấm theo đúng luật kiểm chứng của parser: giá trị toàn chữ số phải nằm
 * trong chuỗi chữ số của cả ảnh; giá trị chữ phải nằm trong một dòng, đúng
 * từng ký tự sau khi bỏ dấu và khoảng trắng, dư tối đa 2 chữ cái mỗi đầu; mã
 * chữ-số so sau khi gộp O/0, I/1, S/5, B/8, Z/2. Không dung sai.
 * Giá trị bắt đầu bằng `*` là CHUỖI CON: chuỗi chữ cái của nó phải nằm trong
 * chuỗi chữ cái của một dòng, không giới hạn phần dư. Dùng cho trường có neo
 * cố định, như lời nhắn `*BUI VAN THANG CHUYEN TIEN` ở màn chuyển khoản.
 *
 * Chữ đọc được lưu ở `<thư mục ảnh>/../ocr-out/<name>/<file>.txt` để soi lại.
 * Đặt OMP_THREAD_LIMIT=1 để Tesseract không mở nhiều luồng.
 */
import sharp, { type Sharp } from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);
const args = process.argv.slice(2);
const dir = args[0];
const opt = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
if (!dir || !existsSync(dir)) {
  console.log("Cách dùng: ocr-grid.ts <thư mục ảnh> --name <tên> --pre <plain|gray-neg|green-neg|red|sharp> [--psm 6] [--lang vie] [--model best|os] [--size 1600] [--photo-size 0] [--no-rotate]");
  process.exit(1);
}
const name = opt("--name", "mac-dinh");
const pre = opt("--pre", "plain");
const psm = opt("--psm", "6");
const lang = opt("--lang", "vie");
const model = opt("--model", "best");
const size = Number(opt("--size", "1600"));
const photoSize = Number(opt("--photo-size", "0"));
const rotate = !args.includes("--no-rotate");
// Script nằm ở <repo>/.claude/skills/ocr-screen-parser/scripts, `.tessdata` ở gốc repo.
const BEST_DIR = path.resolve(import.meta.dir, "../../../../.tessdata");

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
const letters = (s: string) => stripAccents(s).toUpperCase().replace(/[^A-Z]/g, "");
const digits = (s: string) => s.replace(/\D/g, "");
const compact = (s: string) => stripAccents(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const codeKey = (s: string) => compact(s).replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");

/** Giá trị hệ thống có trong chữ OCR không, theo đúng luật kiểm chứng của parser. */
function found(text: string, expected: string): boolean {
  if (/^\d+$/.test(expected)) return digits(text).includes(expected);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (expected.startsWith("*")) {
    const want = letters(expected.slice(1));
    return lines.some((l) => letters(l).includes(want));
  }
  if (/^[A-Za-z]+\d+[A-Za-z0-9]*$|^\d+[A-Za-z]+[A-Za-z0-9]*$/.test(expected)) {
    const key = codeKey(expected);
    return lines.some((l) => l.split(/[^A-Za-z0-9]+/).some((token) => codeKey(token) === key));
  }
  const want = letters(expected);
  return lines.some((l) => {
    const have = letters(l);
    for (let at = have.indexOf(want); at >= 0; at = have.indexOf(want, at + 1)) {
      if (at <= 2 && have.length - at - want.length <= 2) return true;
    }
    return false;
  });
}

const isPhoto = (w: number, h: number) => Math.min(w, h) / Math.max(w, h) > 0.6;
const fit = (edge: number) => ({ width: edge, height: edge, fit: "inside" as const, withoutEnlargement: true });

async function preprocess(file: string, tmp: string): Promise<string> {
  let image: Sharp = sharp(file).rotate();
  const { width = 0, height = 0 } = await image.metadata();
  if (rotate && width > height) {
    const osd = path.join(tmp, "osd.png");
    await image.clone().png().toFile(osd);
    const { stdout } = await run("tesseract", [osd, "-", "--psm", "0"]).catch(() => ({ stdout: "" }));
    image = image.rotate(Number(stdout.match(/Rotate: (\d+)/)?.[1] ?? 0));
  }
  const resize = photoSize && isPhoto(width, height) ? { width: photoSize, fit: "inside" as const } : fit(size);
  image = image.resize(resize);
  switch (pre) {
    case "gray-neg": image = image.grayscale().negate(); break;
    case "green-neg": image = image.extractChannel("green").negate(); break;
    case "red": image = image.extractChannel("red"); break;
    case "sharp": image = image.grayscale().normalise().sharpen({ sigma: 4, m1: 1, m2: 3 }); break;
    case "plain": break;
    default: throw new Error(`Không có tiền xử lý ${pre}`);
  }
  const out = path.join(tmp, "in.png");
  await image.png().toFile(out);
  return out;
}

async function labelsOf(files: string[]): Promise<Record<string, Record<string, string>>> {
  const json = path.join(dir, "labels.json");
  if (existsSync(json)) return JSON.parse(await readFile(json, "utf8"));
  const out: Record<string, Record<string, string>> = {};
  for (const f of files) {
    const m = f.match(/^(.+)-(\d{6,})\.\w+$/);
    if (m) out[f] = { customerName: m[1].toUpperCase().replace(/-/g, " "), accountNumber: m[2] };
  }
  return out;
}

const files = (await readdir(dir)).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).sort();
const labels = await labelsOf(files);
const outDir = path.join(dir, "..", "ocr-out", name);
await mkdir(outDir, { recursive: true });
const tmp = await mkdtemp(path.join(tmpdir(), "ocr-grid-"));
const perField: Record<string, number> = {};
let labeled = 0;
let allOk = 0;
let seconds = 0;
const misses: string[] = [];

for (const f of files) {
  const png = await preprocess(path.join(dir, f), tmp);
  const t0 = Date.now();
  const tessdata = model === "best" && lang === "vie" ? ["--tessdata-dir", BEST_DIR] : [];
  await run("tesseract", [png, png, "-l", lang, "--psm", psm, ...tessdata], { env: { ...process.env, OMP_THREAD_LIMIT: "1" } });
  seconds += (Date.now() - t0) / 1000;
  const text = await readFile(`${png}.txt`, "utf8");
  await writeFile(path.join(outDir, `${f.replace(/\.\w+$/, "")}.txt`), text);
  const expected = labels[f];
  if (!expected) continue;
  labeled++;
  const results = Object.entries(expected).map(([field, value]) => [field, found(text, value)] as const);
  for (const [field, ok] of results) perField[field] = (perField[field] ?? 0) + Number(ok);
  if (results.every(([, ok]) => ok)) allOk++;
  else misses.push(`${f.padEnd(44)} ${results.map(([field, ok]) => `${field}=${ok ? "ok" : "--"}`).join(" ")}`);
}

console.log(`\n== ${name}: ${files.length} ảnh, ${labeled} có nhãn, ${(seconds / files.length).toFixed(2)} s/ảnh`);
for (const [field, n] of Object.entries(perField)) console.log(`   ${field}: ${n}/${labeled}`);
console.log(`   đủ mọi trường: ${allOk}/${labeled}`);
for (const line of misses) console.log("   " + line);
console.log(`chữ OCR: ${outDir}`);
