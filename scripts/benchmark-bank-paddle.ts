import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq } from "drizzle-orm";
import type { PhotoCheckItem, PhotoCheckKey } from "../src/lib/api/photoCheck";
import { db } from "../src/server/db/client";
import {
  bankAccountChecks,
  bankAccountPhotos,
  bankAccounts,
  banks,
  customers,
  referralCodes,
} from "../src/server/db/schema";
import { checkLpb } from "../src/server/ocr/banks/lpb";
import { checkMb } from "../src/server/ocr/banks/mb";
import { checkMsb } from "../src/server/ocr/banks/msb";
import { checkTpbank } from "../src/server/ocr/banks/tpbank";
import { adaptPaddleText, fallbackPhotoIndexes } from "../src/server/ocr/fallback";
import { ocrImage } from "../src/server/ocr/image";
import { ocrWithPaddle } from "../src/server/ocr/paddle";
import type { CheckedItem } from "../src/server/ocr/types";
import { readImage } from "../src/server/storage";

/**
 * Đo lượt đọc lại bằng PaddleOCR cho MỘT ngân hàng, trên dữ liệu local.
 *
 *   bun --env-file=.env.local scripts/benchmark-bank-paddle.ts TPB 50 --dry
 *   PHOTO_CHECK_PADDLE=1 bun --env-file=.env.local scripts/benchmark-bank-paddle.ts TPB 50
 *
 * `--dry` chỉ chạy Tesseract rồi đếm số ảnh sẽ gửi sang Paddle, không gọi
 * Paddle. Ảnh, chữ Tesseract và chữ Paddle đều lưu lại nên chạy lần sau nhanh.
 * Script chỉ ĐỌC database và kho ảnh, không ghi.
 */
const CHECKERS: Record<string, (texts: string[], ctx: never) => CheckedItem[]> = {
  MB: checkMb as never,
  LPB: checkLpb as never,
  MSBa: checkMsb as never,
  MSBb: checkMsb as never,
  TPB: checkTpbank as never,
};

const [bankCode, limitArg] = process.argv.slice(2);
const dry = process.argv.includes("--dry");
const limit = Number(limitArg) || 50;
const check = CHECKERS[bankCode];
if (!check) throw new Error(`Ngân hàng ${bankCode} chưa có bộ nhãn. Chọn: ${Object.keys(CHECKERS).join(", ")}`);

const root = `/private/tmp/mgst-ocr-bench-${bankCode}`;
const imagesDir = path.join(root, "images");
const tessDir = path.join(root, "tesseract");
const paddleDir = path.join(root, "paddle");
for (const dir of [imagesDir, tessDir, paddleDir]) await mkdir(dir, { recursive: true });

type Row = {
  accountId: string;
  oldItems: PhotoCheckItem[];
  context: Record<string, string>;
  files: string[];
};

async function exportRows(): Promise<Row[]> {
  const cached = path.join(root, "manifest.json");
  try {
    return JSON.parse(await readFile(cached, "utf8")) as Row[];
  } catch { /* chưa xuất lần nào */ }

  const checks = await db
    .select({
      accountId: bankAccountChecks.accountId,
      result: bankAccountChecks.result,
      customerName: customers.fullName,
      accountNumber: bankAccounts.accountNumber,
      openedDate: bankAccounts.openedDate,
      referralCode: referralCodes.code,
      referralName: referralCodes.displayName,
      province: referralCodes.province,
      supportBranch: referralCodes.supportBranch,
    })
    .from(bankAccountChecks)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankAccountChecks.accountId))
    .innerJoin(banks, eq(banks.id, bankAccounts.bankId))
    .innerJoin(customers, eq(customers.id, bankAccounts.customerId))
    .innerJoin(referralCodes, eq(referralCodes.id, bankAccounts.referralCodeId))
    .where(eq(banks.code, bankCode))
    .orderBy(desc(bankAccountChecks.createdAt))
    .limit(limit);

  const rows: Row[] = [];
  for (const [index, entry] of checks.entries()) {
    const photos = await db
      .select({ key: bankAccountPhotos.url })
      .from(bankAccountPhotos)
      .where(eq(bankAccountPhotos.accountId, entry.accountId))
      .orderBy(asc(bankAccountPhotos.kind), asc(bankAccountPhotos.sortOrder));
    const files: string[] = [];
    for (const [imageIndex, { key }] of photos.entries()) {
      const stored = await readImage(key);
      if (!stored) continue;
      const body = stored.body instanceof ArrayBuffer
        ? Buffer.from(stored.body)
        : Buffer.from(await new Response(stored.body).arrayBuffer());
      const file = `${String(index).padStart(3, "0")}-${imageIndex}${path.extname(key)}`;
      await writeFile(path.join(imagesDir, file), body);
      files.push(file);
    }
    rows.push({
      accountId: entry.accountId,
      oldItems: (entry.result as { items?: PhotoCheckItem[] } | null)?.items ?? [],
      context: {
        customerName: entry.customerName,
        accountNumber: entry.accountNumber ?? "",
        openedDate: entry.openedDate ?? "",
        referralCode: entry.referralCode ?? "",
        referralName: entry.referralName,
        province: entry.province,
        supportBranch: entry.supportBranch,
      },
      files,
    });
    if ((index + 1) % 10 === 0) console.log(`Đã xuất ${index + 1}/${checks.length} đơn.`);
  }
  await writeFile(cached, JSON.stringify(rows));
  return rows;
}

const tesseractText = async (file: string): Promise<string> => {
  const cached = path.join(tessDir, `${path.parse(file).name}.txt`);
  try {
    return await readFile(cached, "utf8");
  } catch { /* chưa đọc */ }
  const text = await ocrImage(await readFile(path.join(imagesDir, file)));
  await writeFile(cached, text);
  return text;
};

const paddleText = async (file: string): Promise<string> => {
  const cached = path.join(paddleDir, `${path.parse(file).name}.json`);
  try {
    return adaptPaddleText(bankCode, JSON.parse(await readFile(cached, "utf8")) as string[]);
  } catch { /* chưa đọc */ }
  const [lines] = await ocrWithPaddle([await readFile(path.join(imagesDir, file))]);
  await writeFile(cached, JSON.stringify(lines));
  return adaptPaddleText(bankCode, lines);
};

const verdicts = (items: PhotoCheckItem[]): string =>
  (["open", "home", "transfer"] as PhotoCheckKey[])
    .map((key) => `${key}:${items.find((item) => item.key === key)?.verdict ?? "?"}`)
    .join(" ");

/** Chạy `jobs` với tối đa `width` việc cùng lúc. */
async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const at = cursor++;
      out[at] = await jobs[at]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, width) }, worker));
  return out;
}

const TESSERACT_WIDTH = Number(process.env.BENCH_TESSERACT_PARALLEL) || 4;
const PADDLE_WIDTH = Number(process.env.PADDLE_OCR_PARALLEL) || 1;

const rows = await exportRows();
console.log(`${bankCode}: ${rows.length} đơn, ${rows.reduce((n, row) => n + row.files.length, 0)} ảnh.`);

// Lượt 1: Tesseract cho mọi ảnh, chạy song song. `ocrImage` mở 3 tiến trình
// mỗi ảnh, nên bốn luồng là 12 tiến trình.
let readDone = 0;
const allFiles = [...new Set(rows.flatMap((row) => row.files))];
await pool(allFiles.map((file) => async () => {
  await tesseractText(file);
  readDone++;
  if (readDone % 50 === 0) console.log(`Tesseract ${readDone}/${allFiles.length} ảnh.`);
}), TESSERACT_WIDTH);

let sameAsStored = 0;
const storedDiffs: string[] = [];
const retries: number[][] = [];

for (const row of rows) {
  const texts = await Promise.all(row.files.map(tesseractText));
  const base = check(texts, row.context as never);
  if (verdicts(base) === verdicts(row.oldItems)) sameAsStored++;
  else storedDiffs.push(`${row.accountId}  đã lưu ${verdicts(row.oldItems)}  hiện tại ${verdicts(base)}`);
  retries.push(fallbackPhotoIndexes(base, texts.length));
}
const retryAccounts = retries.filter((list) => list.length).length;
const retryPhotos = retries.reduce((n, list) => n + list.length, 0);

// Lượt 2: Paddle cho các ảnh đã chọn, cũng song song. Hàng đợi thật nằm ở
// `ocrWithPaddle`, `PADDLE_OCR_PARALLEL` quyết định bao nhiêu tiến trình.
const improved: string[] = [];
const regressed: string[] = [];
const transitions = new Map<string, number>();

if (!dry) {
  let paddleDone = 0;
  const wanted = [...new Set(rows.flatMap((row, at) => retries[at].map((index) => row.files[index])))];
  await pool(wanted.map((file) => async () => {
    await paddleText(file);
    paddleDone++;
    if (paddleDone % 10 === 0) console.log(`Paddle ${paddleDone}/${wanted.length} ảnh.`);
  }), PADDLE_WIDTH);

  for (const [at, row] of rows.entries()) {
    if (!retries[at].length) continue;
    const texts = await Promise.all(row.files.map(tesseractText));
    const base = check(texts, row.context as never);
    const extra = await Promise.all(retries[at].map((index) => paddleText(row.files[index])));
    const combined = check([...texts, ...extra], row.context as never);
    const after = base.map((item) => {
      if (item.verdict === "pass") return item;
      const next = combined.find((candidate) => candidate.key === item.key);
      return next && next.verdict !== "missing" ? next : item;
    });
    for (const item of after) {
      const before = base.find((value) => value.key === item.key)!;
      if (before.verdict === item.verdict) continue;
      const change = `${item.key}: ${before.verdict} → ${item.verdict}`;
      transitions.set(change, (transitions.get(change) ?? 0) + 1);
    }
    const beforeScore = base.filter((item) => item.verdict === "pass").length;
    const afterScore = after.filter((item) => item.verdict === "pass").length;
    const line = `${row.accountId}  ${beforeScore}/3 → ${afterScore}/3  [${verdicts(after)}]`;
    if (afterScore > beforeScore) improved.push(line);
    if (afterScore < beforeScore) regressed.push(line);
  }
}

console.log("");
console.log(`── ${bankCode}: code hiện tại chỉ Tesseract, so kết quả đã lưu ──`);
console.log(`Giống hệt: ${sameAsStored}/${rows.length}`);
for (const line of storedDiffs) console.log(`  ${line}`);
console.log("");
console.log(`── ${bankCode}: thêm lượt đọc lại bằng Paddle ──`);
console.log(`Đơn gọi Paddle: ${retryAccounts}/${rows.length}`);
console.log(`Ảnh đọc lại: ${retryPhotos}`);
if (dry) {
  console.log("Chạy khô, chưa gọi Paddle. Bỏ --dry và đặt PHOTO_CHECK_PADDLE=1 để đo thật.");
} else {
  console.log(`Chuyển kết quả: ${transitions.size ? JSON.stringify(Object.fromEntries(transitions)) : "không mục nào đổi"}`);
  console.log(`Tốt lên: ${improved.length} đơn`);
  for (const line of improved) console.log(`  ${line}`);
  console.log(`Xấu đi: ${regressed.length} đơn`);
  for (const line of regressed) console.log(`  ${line}`);
}
process.exit(0);
