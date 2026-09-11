import { readFile } from "node:fs/promises";
import { ocrImage } from "../src/server/ocr/image";
import { parseTpbOpenSuccess } from "../src/server/ocr/banks/tpbank";

/**
 * Chạy OCR trên ảnh trong máy rồi in object theo parser của một ngân hàng.
 *
 *   bun scripts/ocr-try.ts tpbank anh1.webp anh2.png
 *   bun scripts/ocr-try.ts tpbank --raw anh1.webp     in cả chữ thô Tesseract trả ra
 *
 * Cần `tesseract` và gói tiếng Việt: xem ghi chú đầu `src/server/ocr/image.ts`.
 */

const PARSERS: Record<string, (text: string) => unknown> = {
  tpbank: parseTpbOpenSuccess,
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

  for (const image of images) {
    console.log(`\n=== ${image} ===`);
    const text = await ocrImage(await readFile(image));
    if (raw) console.log(text + "\n---");
    console.log(parse(text));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
