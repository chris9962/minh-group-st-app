import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhotoCheckItem, PhotoCheckKey } from "../src/lib/api/photoCheck";
import { checkLpb } from "../src/server/ocr/banks/lpb";
import { checkMb } from "../src/server/ocr/banks/mb";
import { checkMsb } from "../src/server/ocr/banks/msb";
import { checkTpbank } from "../src/server/ocr/banks/tpbank";
import { ocrImage } from "../src/server/ocr/image";
import type { CheckedItem } from "../src/server/ocr/types";

/**
 * Đo bộ nhãn của MỘT ngân hàng trên ảnh đã xuất sẵn, không đọc database.
 *
 *   OCR_PASSES=plain,negated,red bun scripts/benchmark-bank-ocr.ts TPB nen
 *   bun scripts/benchmark-bank-ocr.ts TPB moi
 *
 * Tham số thứ hai là TÊN LƯỢT ĐO: chữ Tesseract lưu riêng theo tên đó, nên đổi
 * cấu hình rồi chạy lại không đọc nhầm chữ của lượt trước. So hai lượt bằng
 * `... TPB nen --so moi`.
 */
const CHECKERS: Record<string, (texts: string[], ctx: never) => CheckedItem[]> = {
  MB: checkMb as never,
  LPB: checkLpb as never,
  MSBa: checkMsb as never,
  MSBb: checkMsb as never,
  TPB: checkTpbank as never,
};

/** Thư mục ảnh đã xuất ở các lượt đo trước; mỗi bộ có bố cục riêng. */
const ROOTS: Record<string, { root: string; images: string; manifest: string }> = {
  MB: {
    root: "/private/tmp/mgst-ocr-bench.QB38nP",
    images: "mb50-images",
    manifest: "mb50-manifest.json",
  },
  TPB: { root: "/private/tmp/mgst-ocr-bench-TPB", images: "images", manifest: "manifest.json" },
  MSBb: { root: "/private/tmp/mgst-ocr-bench-MSBb", images: "images", manifest: "manifest.json" },
};

const [bankCode, runName = "mac-dinh"] = process.argv.slice(2);
const compareTo = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1] : "";
const check = CHECKERS[bankCode];
const layout = ROOTS[bankCode];
if (!check || !layout) throw new Error(`Chưa có bộ ảnh cho ${bankCode}. Có: ${Object.keys(ROOTS).join(", ")}`);

type Row = { accountId: string; oldItems: PhotoCheckItem[]; context: Record<string, string>; files: string[] };
const rows = JSON.parse(await readFile(path.join(layout.root, layout.manifest), "utf8")) as Row[];

const textDir = (name: string) => path.join(layout.root, `tesseract-${name}`);
await mkdir(textDir(runName), { recursive: true });

const textOf = async (file: string, name: string, allowRead: boolean): Promise<string> => {
  const cached = path.join(textDir(name), `${path.parse(file).name}.txt`);
  try {
    return await readFile(cached, "utf8");
  } catch {
    if (!allowRead) throw new Error(`Lượt "${name}" chưa có chữ cho ${file}. Chạy lượt đó trước.`);
  }
  const text = await ocrImage(await readFile(path.join(layout.root, layout.images, file)));
  await writeFile(cached, text);
  return text;
};

async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) await jobs[cursor++]();
  };
  await Promise.all(Array.from({ length: width }, worker));
}

const verdicts = (items: PhotoCheckItem[]): string =>
  (["open", "home", "transfer"] as PhotoCheckKey[])
    .map((key) => `${key}:${items.find((item) => item.key === key)?.verdict ?? "?"}`)
    .join(" ");
const score = (items: PhotoCheckItem[]): number => items.filter((item) => item.verdict === "pass").length;

/**
 * `--chi-loi`: chỉ đọc lại ảnh của đơn CHƯA đạt đủ 3 mục ở lượt so sánh.
 *
 * Đơn đã đạt 3/3 thì đọc lại chỉ để xem có tụt không, mà việc đó tốn gấp ba
 * lần thời gian. Dùng khi cần biết nhanh một cấu hình có cứu được đơn hỏng
 * không; muốn chắc là không tụt thì chạy lại không kèm trường tuỳ chọn này.
 */
const onlyFailing = process.argv.includes("--chi-loi");
if (onlyFailing && !compareTo) throw new Error("`--chi-loi` phải đi kèm `--so <lượt>`.");

let wanted = rows;
if (onlyFailing) {
  const keep: Row[] = [];
  for (const row of rows) {
    const texts = await Promise.all(row.files.map((file) => textOf(file, compareTo, false)));
    if (score(check(texts, row.context as never)) < 3) keep.push(row);
  }
  wanted = keep;
  console.log(`Chỉ đọc lại ${wanted.length}/${rows.length} đơn chưa đạt đủ 3 mục ở lượt "${compareTo}".`);
}
const allFiles = [...new Set(wanted.flatMap((row) => row.files))];
let done = 0;
const started = Date.now();
await pool(
  allFiles.map((file) => async () => {
    await textOf(file, runName, true);
    done++;
    if (done % 50 === 0) console.log(`Đọc ${done}/${allFiles.length} ảnh.`);
  }),
  Number(process.env.BENCH_PARALLEL) || 4,
);
const seconds = (Date.now() - started) / 1000;

let perfect = 0;
let better = 0;
let worse = 0;
const changes: string[] = [];
const reasons = new Map<string, number>();

for (const row of wanted) {
  const texts = await Promise.all(row.files.map((file) => textOf(file, runName, false)));
  const items = check(texts, row.context as never);
  if (score(items) === 3) perfect++;
  for (const item of items) {
    if (item.verdict === "pass") continue;
    for (const issue of item.issues ?? [`${item.key} ${item.verdict}`]) {
      reasons.set(issue, (reasons.get(issue) ?? 0) + 1);
    }
  }
  if (!compareTo) continue;
  const before = check(
    await Promise.all(row.files.map((file) => textOf(file, compareTo, false))),
    row.context as never,
  );
  if (verdicts(before) === verdicts(items)) continue;
  if (score(items) > score(before)) better++;
  if (score(items) < score(before)) worse++;
  changes.push(`${row.accountId.slice(0, 8)}  ${score(before)}/3 → ${score(items)}/3   ${verdicts(before)}  →  ${verdicts(items)}`);
}

console.log("");
console.log(`${bankCode}, lượt "${runName}": ${rows.length} đơn, ${allFiles.length} ảnh, đọc hết ${seconds.toFixed(0)} s.`);
console.log(`Đạt cả 3 mục: ${perfect}/${rows.length}`);
console.log("");
console.log("Lý do không đạt:");
for (const [issue, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${issue}`);
if (compareTo) {
  console.log("");
  console.log(`So với lượt "${compareTo}": tốt lên ${better} đơn, xấu đi ${worse} đơn.`);
  for (const line of changes) console.log(`  ${line}`);
}
