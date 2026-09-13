import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhotoCheckItem, PhotoCheckKey } from "../src/lib/api/photoCheck";
import { checkMb, type MbCheckContext } from "../src/server/ocr/banks/mb";
import { adaptPaddleText, fallbackPhotoIndexes } from "../src/server/ocr/fallback";
import { ocrWithPaddle } from "../src/server/ocr/paddle";

/**
 * So kết quả 50 tài khoản MB giữa ba bản, dùng chữ OCR đã lưu ở lượt đo
 * 2026-09-13. Không đọc DB, không chạy lại Tesseract hay Paddle.
 *
 *   A  kết quả đã lưu trong `bank_account_checks.result` lúc đo
 *   B  code hiện tại, chỉ Tesseract — phải giống hệt A
 *   C  code hiện tại, có lượt đọc lại bằng Paddle
 *
 * A khác B nghĩa là bản sửa làm đổi kết quả của đường chạy chính. Đó là lỗi.
 */
const root = "/private/tmp/mgst-ocr-bench.QB38nP";

type Row = {
  accountId: string;
  oldItems: PhotoCheckItem[];
  context: MbCheckContext;
  files: string[];
};

const manifest = JSON.parse(await readFile(path.join(root, "mb50-manifest.json"), "utf8")) as Row[];

/** Chữ Paddle đã lưu; thiếu thì đọc thật rồi lưu lại để lượt sau khỏi chạy. */
const paddleLines = async (file: string): Promise<string[]> => {
  const cached = path.join(root, "mb50-paddle", `${path.parse(file).name}_res.json`);
  try {
    return (JSON.parse(await readFile(cached, "utf8")) as { rec_texts: string[] }).rec_texts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const image = await readFile(path.join(root, "mb50-images", file));
  const [lines] = await ocrWithPaddle([image]);
  await writeFile(cached, JSON.stringify({ rec_texts: lines }));
  console.log(`  Paddle đọc mới: ${file}`);
  return lines;
};

const verdicts = (items: PhotoCheckItem[]): string =>
  (["open", "home", "transfer"] as PhotoCheckKey[])
    .map((key) => `${key}:${items.find((item) => item.key === key)?.verdict ?? "?"}`)
    .join(" ");

let sameAsStored = 0;
const baselineDiffs: string[] = [];
let retried = 0;
let retriedPhotos = 0;
const improved: string[] = [];
const regressed: string[] = [];
const transitions = new Map<string, number>();

for (const row of manifest) {
  const texts = await Promise.all(row.files.map((file) =>
    readFile(path.join(root, "mb50-tesseract", `${path.parse(file).name}.txt`), "utf8")));

  const tesseractOnly = checkMb(texts, row.context);
  if (verdicts(tesseractOnly) === verdicts(row.oldItems)) sameAsStored++;
  else baselineDiffs.push(`${row.accountId}\n    đã lưu: ${verdicts(row.oldItems)}\n    hiện tại: ${verdicts(tesseractOnly)}`);

  const retryIndexes = fallbackPhotoIndexes(tesseractOnly, texts.length);
  let withPaddle = tesseractOnly;
  if (retryIndexes.length) {
    retried++;
    retriedPhotos += retryIndexes.length;
    const lines: string[][] = [];
    for (const index of retryIndexes) lines.push(await paddleLines(row.files[index]));
    const extra = lines.map((value) => adaptPaddleText("MB", value));
    const combined = checkMb([...texts, ...extra], row.context);
    withPaddle = tesseractOnly.map((item) => {
      if (item.verdict === "pass") return item;
      const next = combined.find((candidate) => candidate.key === item.key);
      return next && next.verdict !== "missing" ? next : item;
    });
  }

  for (const item of withPaddle) {
    const before = tesseractOnly.find((value) => value.key === item.key)!;
    if (before.verdict === item.verdict) continue;
    const change = `${item.key}: ${before.verdict} → ${item.verdict}`;
    transitions.set(change, (transitions.get(change) ?? 0) + 1);
  }
  const before = tesseractOnly.filter((item) => item.verdict === "pass").length;
  const after = withPaddle.filter((item) => item.verdict === "pass").length;
  if (after > before) improved.push(`${row.accountId}  ${before}/3 → ${after}/3  [${verdicts(withPaddle)}]`);
  if (after < before) regressed.push(`${row.accountId}  ${before}/3 → ${after}/3  [${verdicts(withPaddle)}]`);
}

const total = manifest.length;
console.log(`Đơn so được: ${total}`);
console.log("");
console.log("── A so B: code hiện tại chỉ Tesseract, so kết quả đã lưu ──");
console.log(`Giống hệt: ${sameAsStored}/${total}`);
if (baselineDiffs.length) {
  console.log(`KHÁC: ${baselineDiffs.length} đơn`);
  for (const line of baselineDiffs) console.log(`  ${line}`);
} else {
  console.log("Không đơn nào đổi kết quả. Bản sửa không đụng đường chạy chính.");
}
console.log("");
console.log("── B so C: thêm lượt đọc lại bằng Paddle ──");
console.log(`Đơn có gọi Paddle: ${retried}/${total}, tổng ${retriedPhotos} ảnh đọc lại`);
console.log(`Chuyển kết quả: ${transitions.size ? JSON.stringify(Object.fromEntries(transitions)) : "không mục nào đổi"}`);
console.log(`Tốt lên: ${improved.length} đơn`);
for (const line of improved) console.log(`  ${line}`);
console.log(`Xấu đi: ${regressed.length} đơn`);
for (const line of regressed) console.log(`  ${line}`);
