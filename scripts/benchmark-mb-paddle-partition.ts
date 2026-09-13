import { access, mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";

/** Chia ảnh chưa OCR thành ba lô bằng symlink, không di chuyển hay xoá ảnh gốc. */
const root = "/private/tmp/mgst-ocr-bench.QB38nP";
const manifest = JSON.parse(await readFile(path.join(root, "mb50-manifest.json"), "utf8")) as { files: string[] }[];
const pending: string[] = [];
for (const file of manifest.flatMap((row) => row.files)) {
  try {
    await access(path.join(root, "mb50-paddle", `${path.parse(file).name}_res.json`));
  } catch {
    pending.push(file);
  }
}

for (let batch = 0; batch < 3; batch++) {
  const target = path.join(root, `mb50-batch-${batch}`);
  await mkdir(target, { recursive: true });
  const files = pending.filter((_, index) => index % 3 === batch);
  for (const file of files) await symlink(path.join(root, "mb50-images", file), path.join(target, file));
  console.log(`Lô ${batch}: ${files.length} ảnh.`);
}
