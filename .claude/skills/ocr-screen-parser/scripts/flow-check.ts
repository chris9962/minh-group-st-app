/**
 * Chạy `check<Bank>Images` THẬT trên một thư mục ảnh có nhãn, mỗi ảnh là một
 * tài khoản, và so kết luận của mục cần kiểm với nhãn. Bước 7.1 của skill.
 *
 *   bun .claude/skills/ocr-screen-parser/scripts/flow-check.ts "<thư mục ảnh>" --bank TPB --item open
 *
 * Nhãn từ `labels.json` hoặc tên file như `ocr-grid.ts`; các trường của nhãn
 * đổ thẳng vào `ctx` (`referralCode`, `accountNumber`, `customerName`).
 * Kết luận đúng là `pass` khi nhãn có đủ trường của mục đó, `fail` khi nhãn
 * cố ý thiếu trường (ảnh không có giá trị đó, ví dụ chưa bấm "Xem thêm").
 * In từng ảnh lệch kèm `found` và `note` để soi, rồi tổng: đúng / sai, giây
 * một ảnh. Đặt OMP_THREAD_LIMIT=1 khi chạy.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { checkTpbankImages, type TpbCheckContext } from "../../../../src/server/ocr/banks/tpbank";

const args = process.argv.slice(2);
const dir = args[0];
const opt = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
if (!dir || !existsSync(dir)) {
  console.log("Cách dùng: flow-check.ts <thư mục ảnh> --bank TPB --item open|home|transfer");
  process.exit(1);
}
const bank = opt("--bank", "TPB");
const item = opt("--item", "open");
/** Trường của nhãn mà mục này cần; thiếu trường nào thì kết luận đúng là `fail`. */
const NEEDS: Record<string, string[]> = { open: ["referralCode"], home: ["customerName", "accountNumber"], transfer: [] };

type Checker = (images: Buffer[], ctx: TpbCheckContext) => Promise<{ key: string; verdict: string; found: string; note: string }[]>;
const CHECKERS: Record<string, Checker> = { TPB: checkTpbankImages };
const check = CHECKERS[bank];
if (!check) {
  console.log(`Chưa có checker cho ${bank}; thêm vào CHECKERS của script này.`);
  process.exit(1);
}

const files = (await readdir(dir)).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).sort();
const json = path.join(dir, "labels.json");
const labels: Record<string, Record<string, string>> = existsSync(json) ? JSON.parse(await readFile(json, "utf8")) : {};
for (const f of files) {
  const m = f.match(/^(.+)-(\d{6,})\.\w+$/);
  if (!labels[f] && m) labels[f] = { customerName: m[1].toUpperCase().replace(/-/g, " "), accountNumber: m[2] };
}

let right = 0;
let seconds = 0;
const wrong: string[] = [];
for (const f of files) {
  const label = labels[f];
  if (!label) continue;
  const ctx: TpbCheckContext = {
    referralCode: label.referralCode ?? "",
    customerName: label.customerName ?? "",
    accountNumber: label.accountNumber ?? "",
  };
  const t0 = Date.now();
  const got = (await check([await readFile(path.join(dir, f))], ctx)).find((r) => r.key === item);
  seconds += (Date.now() - t0) / 1000;
  const want = NEEDS[item].every((k) => label[k]) ? "pass" : "fail";
  if (got?.verdict === want) right++;
  else wrong.push(`${f.padEnd(44)} ${got?.verdict ?? "?"} (đúng: ${want})  found=${got?.found ?? ""}  ${got?.note ?? ""}`);
}
console.log(`\n== ${bank} ${item}: ${right}/${right + wrong.length} kết luận đúng, ${(seconds / files.length).toFixed(2)} s/ảnh`);
for (const line of wrong) console.log("   " + line);
