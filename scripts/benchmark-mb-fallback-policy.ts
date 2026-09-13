import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhotoCheckItem, PhotoCheckKey } from "../src/lib/api/photoCheck";
import { checkMb, type MbCheckContext } from "../src/server/ocr/banks/mb";
import { adaptPaddleText, fallbackPhotoIndexes } from "../src/server/ocr/fallback";
import { ocrWithPaddle } from "../src/server/ocr/paddle";
import type { CheckedItem } from "../src/server/ocr/types";

/**
 * So hai cách chọn ảnh gửi sang PaddleOCR, trên 50 tài khoản MB đo 2026-09-13.
 *
 *   A  cách đang có: bỏ mục "không khớp", trần 3 ảnh
 *   B  mọi mục không đạt đều đọc lại, không phân biệt lý do, không trần
 *
 * B trả lời câu hỏi: Tesseract đọc rõ chữ nhưng đọc SAI thì Paddle có sửa được
 * không. Chạy với `PHOTO_CHECK_PADDLE=1`; chữ Paddle lưu lại để chạy lần sau.
 */
const root = "/private/tmp/mgst-ocr-bench.QB38nP";

type Row = { accountId: string; oldItems: PhotoCheckItem[]; context: MbCheckContext; files: string[] };
const manifest = JSON.parse(await readFile(path.join(root, "mb50-manifest.json"), "utf8")) as Row[];

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
  return lines;
};

/** Luật CŨ, giữ lại để so: bỏ mục "không khớp", trần 3 ảnh, chia theo vòng. */
function oldRule(items: CheckedItem[], photoCount: number): number[] {
  const needsSecondRead = (item: CheckedItem): boolean =>
    item.verdict === "missing" ||
    (item.verdict === "fail" &&
      !item.issues?.some((issue) => issue.toLocaleLowerCase("vi").includes("không khớp")) &&
      Boolean(item.issues?.some((issue) => issue.startsWith("Không đọc được"))));

  const all = Array.from({ length: photoCount }, (_, index) => index);
  const claimed = new Set(items.map((item) => item.photoIndex).filter((index) => index !== undefined));
  const queues = items.filter(needsSecondRead).map((item) =>
    item.photoIndex !== undefined
      ? [item.photoIndex]
      : [...all.filter((index) => !claimed.has(index)), ...all.filter((index) => claimed.has(index))],
  );
  const picked: number[] = [];
  for (let round = 0; picked.length < 3 && queues.some((queue) => queue.length > round); round++) {
    for (const queue of queues) {
      const index = queue[round];
      if (index === undefined || picked.includes(index)) continue;
      picked.push(index);
      if (picked.length >= 3) break;
    }
  }
  return picked;
}

const verdicts = (items: PhotoCheckItem[]): string =>
  (["open", "home", "transfer"] as PhotoCheckKey[])
    .map((key) => `${key}:${items.find((item) => item.key === key)?.verdict ?? "?"}`)
    .join(" ");

const merge = (base: CheckedItem[], combined: CheckedItem[]): CheckedItem[] =>
  base.map((item) => {
    if (item.verdict === "pass") return item;
    const next = combined.find((candidate) => candidate.key === item.key);
    return next && next.verdict !== "missing" ? next : item;
  });

type Policy = {
  name: string;
  pick: (items: CheckedItem[], photoCount: number) => number[];
  photos: number;
  accounts: number;
  improved: string[];
  regressed: string[];
  transitions: Map<string, number>;
};

const policies: Policy[] = [
  { name: "A. Luật cũ: bỏ mục không khớp, trần 3 ảnh", pick: oldRule, photos: 0, accounts: 0, improved: [], regressed: [], transitions: new Map() },
  { name: "B. Luật đang dùng: mọi mục không đạt, trần 8 ảnh", pick: fallbackPhotoIndexes, photos: 0, accounts: 0, improved: [], regressed: [], transitions: new Map() },
];

let totalPhotos = 0;
let done = 0;
for (const row of manifest) {
  const texts = await Promise.all(row.files.map((file) =>
    readFile(path.join(root, "mb50-tesseract", `${path.parse(file).name}.txt`), "utf8")));
  totalPhotos += texts.length;
  const base = checkMb(texts, row.context);

  for (const policy of policies) {
    const indexes = policy.pick(base, texts.length);
    if (!indexes.length) continue;
    policy.accounts++;
    policy.photos += indexes.length;
    const extra: string[] = [];
    for (const index of indexes) extra.push(adaptPaddleText("MB", await paddleLines(row.files[index])));
    const after = merge(base, checkMb([...texts, ...extra], row.context));

    for (const item of after) {
      const before = base.find((value) => value.key === item.key)!;
      if (before.verdict === item.verdict) continue;
      const change = `${item.key}: ${before.verdict} → ${item.verdict}`;
      policy.transitions.set(change, (policy.transitions.get(change) ?? 0) + 1);
    }
    const beforeScore = base.filter((item) => item.verdict === "pass").length;
    const afterScore = after.filter((item) => item.verdict === "pass").length;
    const line = `${row.accountId}  ${beforeScore}/3 → ${afterScore}/3  [${verdicts(after)}]`;
    if (afterScore > beforeScore) policy.improved.push(line);
    if (afterScore < beforeScore) policy.regressed.push(line);
  }
  done++;
  if (done % 10 === 0) console.log(`Đã xong ${done}/${manifest.length} đơn.`);
}

console.log("");
console.log(`50 tài khoản, ${totalPhotos} ảnh, nền là lượt Tesseract.`);
for (const policy of policies) {
  console.log("");
  console.log(`── ${policy.name} ──`);
  console.log(`Đơn gọi Paddle: ${policy.accounts}/${manifest.length}`);
  console.log(`Ảnh đọc lại: ${policy.photos}/${totalPhotos}`);
  console.log(`Chuyển kết quả: ${policy.transitions.size ? JSON.stringify(Object.fromEntries(policy.transitions)) : "không mục nào đổi"}`);
  console.log(`Tốt lên: ${policy.improved.length} đơn`);
  for (const line of policy.improved) console.log(`  ${line}`);
  console.log(`Xấu đi: ${policy.regressed.length} đơn`);
  for (const line of policy.regressed) console.log(`  ${line}`);
}
