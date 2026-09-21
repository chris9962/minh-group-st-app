import { readFile } from "node:fs/promises";
import { closeOcr, ocrLines } from "../src/server/ocr/reader";
import { checkMsb, msbFacts } from "../src/server/ocr/banks/msb";
import { checkLpb, lpbFacts } from "../src/server/ocr/banks/lpb";
import { checkMb, mbFacts } from "../src/server/ocr/banks/mb";
import { checkTpbank, tpbFacts } from "../src/server/ocr/banks/tpbank";
import { checkVpb, vpbFacts } from "../src/server/ocr/banks/vpbank";

/**
 * Đọc chữ trên ảnh trong máy rồi in ra, kèm kết quả parser của một ngân hàng.
 *
 *   bun scripts/ocr-try.ts tpbank --raw anh1.webp             in cả dòng chữ đọc được
 *   OCR_CTX='{"referralCode":"AT107","customerName":"...","accountNumber":"..."}' \
 *     bun scripts/ocr-try.ts tpbank anh*.webp                  bốn giá trị từng ảnh + chấm cả bộ như worker
 *   OCR_CTX='{"referralCode":"...","referralName":"ACT24","customerName":"...","accountNumber":"..."}' \
 *     bun scripts/ocr-try.ts msb anh*.webp
 *
 * Cần Python với paddleocr và vietocr: xem đầu `scripts/ocr-server.py`. Máy
 * local đặt `OCR_PYTHON` trỏ vào python của venv đã cài.
 */

// Ngân hàng chấm bằng tìm giá trị: `OCR_CTX` là context của bộ nhãn, thiếu thì chỉ in chữ.
const ctx = process.env.OCR_CTX ? JSON.parse(process.env.OCR_CTX) : null;
const lineCount = (text: string) => text.split("\n").length + " dòng";

const PARSERS: Record<string, (text: string) => unknown> = {
  lpb: ctx ? (text) => lpbFacts(text, ctx) : lineCount,
  mb: ctx ? (text) => mbFacts(text, ctx) : lineCount,
  msb: ctx ? (text) => msbFacts(text, ctx) : lineCount,
  tpbank: ctx ? (text) => tpbFacts(text, ctx) : lineCount,
  vpbank: ctx ? (text) => vpbFacts(text, ctx) : lineCount,
};

const CHECKS: Record<string, (texts: string[], ctx: never) => unknown> = { lpb: checkLpb, mb: checkMb, msb: checkMsb, tpbank: checkTpbank, vpbank: checkVpb };

async function main() {
  const [bank, ...rest] = process.argv.slice(2);
  const parse = bank ? PARSERS[bank] : undefined;
  const raw = rest.includes("--raw");
  const images = rest.filter((a) => !a.startsWith("--"));

  if (!parse || images.length === 0) {
    console.log(`Cách dùng: bun scripts/ocr-try.ts <${Object.keys(PARSERS).join("|")}> [--raw] <ảnh...>`);
    process.exit(1);
  }

  const texts: string[] = [];
  for (const image of images) {
    console.log(`\n=== ${image} ===`);
    const t = Date.now();
    const text = (await ocrLines(await readFile(image))).join("\n");
    texts.push(text);
    console.log(`${Date.now() - t} ms`);
    if (raw) console.log(text + "\n---");
    console.log(parse(text));
  }

  if (ctx && CHECKS[bank]) {
    console.log("\n=== chấm cả bộ ===");
    console.log(CHECKS[bank](texts, ctx as never));
  }
  await closeOcr();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
