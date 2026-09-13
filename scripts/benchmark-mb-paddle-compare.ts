import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkMb, type MbCheckContext } from "../src/server/ocr/banks/mb";
import { compact } from "../src/server/ocr/text";
import type { PhotoCheckItem } from "../src/lib/api/photoCheck";

/** Chỉ sửa NHÃN UI bị PaddleOCR rụng nguyên âm; giá trị OCR giữ nguyên. */
function adaptLabels(values: string[]): string {
  const lines = values.map((value) => {
    const label = compact(value);
    if (label.startsWith("DANGKYTAIKH")) return "Đăng ký tài khoản";
    if (label.includes("MARM") && label.startsWith("MANG")) return "Mã người giới thiệu (Mã RM)";
    if (label.startsWith("CHON") && label.includes("THANHPH")) return "Chọn Tỉnh/Thành phố";
    if ((label.startsWith("CHON") || label.startsWith("CHN")) && label.includes("CHINHANH") && label.endsWith("HTR")) return "Chọn chi nhánh hỗ trợ";
    if ((label.startsWith("HOSO") || label.startsWith("HSO")) && label.endsWith("DUNG")) return "Hồ sơ người dùng";
    if (label.startsWith("TRUY") && label.includes("GIAOD")) return "Truy vấn giao dịch";
    if (label.includes("LICHSUGIAOD")) return "Lịch sử giao dịch";
    if (label.startsWith("THONGBAO") && label.includes("DONG") && label.endsWith("SDU")) return "Thông báo biến động số dư";
    return value;
  });
  // Paddle tách nhãn TIỀN RA và số tiền thành hai hộp chữ; parser cũ chờ cùng dòng.
  for (let i = 0; i < lines.length - 1; i++) {
    if (compact(lines[i]) === "TIENRA" && /^[-~]\s*\d[\d.,]*\s*VND$/i.test(lines[i + 1])) {
      lines[i] += ` ${lines[i + 1]}`;
    }
  }
  return lines.join("\n");
}

const root = "/private/tmp/mgst-ocr-bench.QB38nP";
const manifest = JSON.parse(await readFile(path.join(root, "mb50-manifest.json"), "utf8")) as {
  accountId: string;
  oldItems: PhotoCheckItem[];
  context: MbCheckContext;
  files: string[];
}[];

let available = 0;
let baselineMismatches = 0;
const transitions = new Map<string, number>();
const hybridTransitions = new Map<string, number>();
const changed: { accountId: string; old: number; next: number; items: string[] }[] = [];
const hybridChanged: typeof changed = [];
for (const row of manifest) {
  const tesseractTexts = await Promise.all(row.files.map((file) =>
    readFile(path.join(root, "mb50-tesseract", `${path.parse(file).name}.txt`), "utf8")));
  const baselineItems = checkMb(tesseractTexts, row.context);
  if (baselineItems.some((item) => row.oldItems.find((old) => old.key === item.key)?.verdict !== item.verdict)) {
    baselineMismatches++;
  }
  const textPaths = row.files.map((file) => path.join(root, "mb50-paddle", `${path.parse(file).name}_res.json`));
  const texts: string[] = [];
  for (const file of textPaths) {
    try {
      const result = JSON.parse(await readFile(file, "utf8")) as { rec_texts: string[] };
      texts.push(adaptLabels(result.rec_texts));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  if (texts.length !== row.files.length) continue;
  available++;
  const nextItems = checkMb(texts, row.context);
  const hybridItems = checkMb(tesseractTexts.flatMap((text, index) => [text, texts[index]]), row.context);
  const oldScore = row.oldItems.filter((item) => item.verdict === "pass").length;
  const nextScore = nextItems.filter((item) => item.verdict === "pass").length;
  const hybridScore = hybridItems.filter((item) => item.verdict === "pass").length;
  const itemChanges: string[] = [];
  const hybridItemChanges: string[] = [];
  for (const item of nextItems) {
    const old = row.oldItems.find((value) => value.key === item.key);
    const key = `${item.key}: ${old?.verdict ?? "?"} → ${item.verdict}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    if (old?.verdict !== item.verdict) itemChanges.push(key);
  }
  for (const item of hybridItems) {
    const old = row.oldItems.find((value) => value.key === item.key);
    const key = `${item.key}: ${old?.verdict ?? "?"} → ${item.verdict}`;
    hybridTransitions.set(key, (hybridTransitions.get(key) ?? 0) + 1);
    if (old?.verdict !== item.verdict) hybridItemChanges.push(key);
  }
  if (itemChanges.length) changed.push({ accountId: row.accountId, old: oldScore, next: nextScore, items: itemChanges });
  if (hybridItemChanges.length) hybridChanged.push({ accountId: row.accountId, old: oldScore, next: hybridScore, items: hybridItemChanges });
}

console.log(`So được ${available}/${manifest.length} đơn.`);
console.log(`Tesseract chạy lại khác kết quả đã lưu: ${baselineMismatches}/${manifest.length} đơn.`);
console.log(`Chỉ Paddle - chuyển từng phép kiểm: ${JSON.stringify(Object.fromEntries(transitions))}`);
console.log(`Chỉ Paddle - đơn thay đổi: ${JSON.stringify(changed)}`);
console.log(`Kết hợp - chuyển từng phép kiểm: ${JSON.stringify(Object.fromEntries(hybridTransitions))}`);
console.log(`Kết hợp - đơn thay đổi: ${JSON.stringify(hybridChanged)}`);
