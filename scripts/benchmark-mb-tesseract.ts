import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ocrImage } from "../src/server/ocr/image";

/** OCR lại ảnh đã xuất để thử ghép PaddleOCR + Tesseract, không đọc/ghi DB. */
const root = "/private/tmp/mgst-ocr-bench.QB38nP";
const manifest = JSON.parse(await readFile(path.join(root, "mb50-manifest.json"), "utf8")) as { files: string[] }[];
const files = manifest.flatMap((row) => row.files);
const outputDir = path.join(root, "mb50-tesseract");
await mkdir(outputDir, { recursive: true });

let cursor = 0;
let completed = 0;
async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++];
    const image = await readFile(path.join(root, "mb50-images", file));
    const text = await ocrImage(image);
    await writeFile(path.join(outputDir, `${path.parse(file).name}.txt`), text);
    completed++;
    if (completed % 25 === 0) console.log(`Tesseract: ${completed}/${files.length} ảnh.`);
  }
}

await Promise.all(Array.from({ length: 4 }, worker));
