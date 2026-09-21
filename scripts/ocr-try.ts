import { readFile } from "node:fs/promises";
import { closeOcr, ocrLines } from "../src/server/ocr/reader";
import { parseMsbOpenSuccess, parseMsbSupplement, parseMsbTransfer } from "../src/server/ocr/banks/msb";
import { parseMbProfile, parseMbRegistration, parseMbTransfer } from "../src/server/ocr/banks/mb";
import { checkTpbank } from "../src/server/ocr/banks/tpbank";

/**
 * Đọc chữ trên ảnh trong máy rồi in ra, kèm kết quả parser của một ngân hàng.
 *
 *   bun scripts/ocr-try.ts tpbank anh1.webp anh2.png
 *   bun scripts/ocr-try.ts tpbank --raw anh1.webp             in cả dòng chữ đọc được
 *   TPB_CTX='{"referralCode":"AT107","customerName":"...","accountNumber":"..."}' \
 *     bun scripts/ocr-try.ts tpbank anh*.webp                  chấm cả bộ ảnh như worker
 *   bun scripts/ocr-try.ts msb-supplement --raw anh1.webp
 *
 * Cần Python với paddleocr và vietocr: xem đầu `scripts/ocr-server.py`. Máy
 * local đặt `OCR_PYTHON` trỏ vào python của venv đã cài.
 */

const PARSERS: Record<string, (text: string) => unknown> = {
  "mb-registration": parseMbRegistration,
  "mb-profile": parseMbProfile,
  "mb-transfer": parseMbTransfer,
  "msb-open": parseMsbOpenSuccess,
  "msb-supplement": parseMsbSupplement,
  "msb-transfer": parseMsbTransfer,
  tpbank: (text) => text.split("\n").length + " dòng",
};

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

  if (bank === "tpbank" && process.env.TPB_CTX) {
    console.log("\n=== chấm cả bộ ===");
    console.log(checkTpbank(texts, JSON.parse(process.env.TPB_CTX)));
  }
  await closeOcr();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
