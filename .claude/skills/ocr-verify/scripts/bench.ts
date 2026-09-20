/**
 * Đo bộ kiểm ảnh trên N tài khoản thật: dữ liệu hệ thống từ DB local, ảnh từ
 * kho S3, đọc bằng `reader.ts`, chấm bằng `checkTpbank`. Bốn lệnh, chạy từ
 * thư mục `mgst-app`, cần `.env.local` đã `source`:
 *
 *   bun .claude/skills/ocr-verify/scripts/bench.ts xuat <thư mục> [--n 60] [--bank TPB] [--tu 2026-09-01] [--them id,id]
 *   bun .claude/skills/ocr-verify/scripts/bench.ts tai  <thư mục>
 *   bun .claude/skills/ocr-verify/scripts/bench.ts doc  <thư mục> <tên lượt>
 *   bun .claude/skills/ocr-verify/scripts/bench.ts so   <thư mục> <lượt A> <lượt B>
 *
 * `xuat` ghi `manifest.json`: mỗi tài khoản có `context` (mã GT, tên, STK),
 * khoá ảnh, và `oldItems` là kết quả lượt kiểm mới nhất trong DB. `--them`
 * nhét thêm tài khoản chỉ định, ví dụ ca đang soi.
 *
 * `tai` tải ảnh về `<thư mục>/images/<accountId>/<i>.webp`, 4 luồng, mỗi ảnh
 * thử 3 lần với timeout 30 giây: SDK S3 không có timeout, một ảnh treo là treo
 * cả lượt (đo 2026-09-19).
 *
 * `doc` đọc mọi ảnh bằng `ocrLines`, lưu `<thư mục>/<tên lượt>/<accountId>/<i>.json`;
 * ảnh đã có thì bỏ qua, nên chạy lại chỉ đọc phần thiếu. Đổi model hay sửa
 * `ocr-server.py` thì đặt tên lượt mới. `OCR_PYTHON` trỏ python của venv.
 *
 * `so` chấm cả hai lượt bằng `checkTpbank` HIỆN TẠI rồi in tài khoản đổi kết
 * quả. Lượt A ghi `db` thì lấy `oldItems` trong manifest làm mốc. So luật cũ
 * với luật mới trên cùng chữ: `git show HEAD:...tpbank.ts` ra file tạm, sửa
 * import ở đây tạm thời, so xong xoá.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { Client } from "pg";
import type { PhotoCheckItem } from "../../../../src/lib/api/photoCheck";
import { checkTpbank, type TpbCheckContext } from "../../../../src/server/ocr/banks/tpbank";
import { closeOcr, ocrLines } from "../../../../src/server/ocr/reader";
import { readImage } from "../../../../src/server/storage";

type Row = {
  accountId: string;
  context: TpbCheckContext;
  photos: string[];
  oldItems: PhotoCheckItem[] | null;
};

const [cmd, root, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const at = rest.indexOf(name);
  return at >= 0 ? rest[at + 1] : fallback;
};
if (!cmd || !root) {
  console.log("Cách dùng: bench.ts <xuat|tai|doc|so> <thư mục> ...");
  process.exit(1);
}
const manifest = async (): Promise<Row[]> => JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));

async function xuat() {
  const n = Number(flag("--n", "60"));
  const bank = flag("--bank", "TPB");
  const from = flag("--tu", "2026-09-01");
  const extra = flag("--them", "").split(",").filter(Boolean);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<Row>(
    `with pick as (
       (select a.id from bank_accounts a
          join banks b on b.id = a.bank_id
          join referral_codes r on r.id = a.referral_code_id
        where b.code = $1 and a.status = 'done' and a.account_number is not null and r.code <> ''
          and a.created_at >= $2
          and (select count(*) from bank_account_photos p where p.account_id = a.id) between 3 and 6
        order by random() limit $3)
       union select unnest($4::uuid[]))
     select a.id as "accountId",
       json_build_object('referralCode', coalesce(r.code, ''), 'customerName', c.full_name,
                         'accountNumber', coalesce(a.account_number, '')) as context,
       (select json_agg(p.url order by p.sort_order) from bank_account_photos p where p.account_id = a.id and p.kind = 'opening') as photos,
       (select k.result->'items' from bank_account_checks k
         where k.account_id = a.id and k.status = 'done' order by k.created_at desc limit 1) as "oldItems"
     from pick join bank_accounts a on a.id = pick.id
       join customers c on c.id = a.customer_id
       left join referral_codes r on r.id = a.referral_code_id`,
    [bank, from, n, extra],
  );
  await client.end();
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/manifest.json`, JSON.stringify(rows, null, 1));
  console.log(`${rows.length} tài khoản, ${rows.reduce((s, r) => s + r.photos.length, 0)} ảnh → ${root}/manifest.json`);
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

async function tai() {
  const jobs: { key: string; out: string }[] = [];
  for (const row of await manifest()) {
    await mkdir(`${root}/images/${row.accountId}`, { recursive: true });
    for (const [i, key] of row.photos.entries()) {
      const out = `${root}/images/${row.accountId}/${i}.webp`;
      if (!(await stat(out).catch(() => null))) jobs.push({ key, out });
    }
  }
  let ok = 0;
  let missing = 0;
  let next = 0;
  const one = async (key: string, out: string) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const stored = await withTimeout(readImage(key), 30_000);
        if (!stored) return false;
        const body =
          stored.body instanceof ArrayBuffer
            ? Buffer.from(stored.body)
            : Buffer.from(await withTimeout(new Response(stored.body).arrayBuffer(), 30_000));
        await writeFile(out, body);
        return true;
      } catch (e) {
        console.log(`lần ${attempt} ${key}: ${(e as Error).message}`);
      }
    }
    return false;
  };
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (await one(job.key, job.out)) ok++;
      else missing++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`tải ${ok} ảnh, thiếu ${missing}`);
}

async function doc() {
  const run = rest[0];
  if (!run) throw new Error("Thiếu tên lượt.");
  let done = 0;
  let ms = 0;
  for (const row of await manifest()) {
    const dir = `${root}/${run}/${row.accountId}`;
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < row.photos.length; i++) {
      const out = `${dir}/${i}.json`;
      if (await stat(out).catch(() => null)) continue;
      const image = await readFile(`${root}/images/${row.accountId}/${i}.webp`).catch(() => null);
      if (!image) {
        console.log(`thiếu ảnh ${row.accountId}/${i}`);
        continue;
      }
      const t = Date.now();
      try {
        const lines = await ocrLines(image);
        ms += Date.now() - t;
        done++;
        await writeFile(out, JSON.stringify(lines, null, 1));
      } catch (e) {
        console.log(`LỖI ${row.accountId}/${i}: ${(e as Error).message}`);
      }
    }
    console.log(`${row.accountId.slice(0, 8)} xong, ${done} ảnh, ${(ms / Math.max(done, 1) / 1000).toFixed(1)} s/ảnh`);
  }
  await closeOcr();
}

const KEYS = ["open", "home", "transfer"] as const;
const verdictOf = (items: PhotoCheckItem[], key: string) => items.find((i) => i.key === key)?.verdict ?? "?";

async function itemsOf(run: string, row: Row): Promise<PhotoCheckItem[] | null> {
  const texts: string[] = [];
  for (let i = 0; i < row.photos.length; i++) {
    const lines = await readFile(`${root}/${run}/${row.accountId}/${i}.json`, "utf8")
      .then((s) => JSON.parse(s) as string[])
      .catch(() => null);
    if (!lines) return null;
    texts.push(lines.join("\n"));
  }
  return checkTpbank(texts, row.context);
}

async function so() {
  const [a, b] = rest;
  if (!a || !b) throw new Error("Cần hai tên lượt.");
  const tally = { a: { open: 0, home: 0, transfer: 0, all: 0 }, b: { open: 0, home: 0, transfer: 0, all: 0 } };
  const diffs: string[] = [];
  let n = 0;
  for (const row of await manifest()) {
    const ia = a === "db" ? row.oldItems : await itemsOf(a, row);
    const ib = await itemsOf(b, row);
    if (!ia || !ib) continue;
    n++;
    let allA = true;
    let allB = true;
    const changed: string[] = [];
    for (const key of KEYS) {
      const va = verdictOf(ia, key);
      const vb = verdictOf(ib, key);
      if (va === "pass") tally.a[key]++;
      else allA = false;
      if (vb === "pass") tally.b[key]++;
      else allB = false;
      if (va !== vb) changed.push(`${key}: ${va} → ${vb}`);
    }
    if (allA) tally.a.all++;
    if (allB) tally.b.all++;
    if (changed.length) {
      const note = (items: PhotoCheckItem[]) =>
        items.filter((i) => i.verdict !== "pass").map((i) => i.note).join(" ") || "-";
      diffs.push(`${row.accountId.slice(0, 8)}  ${changed.join(", ")}\n    ${a}: ${note(ia)}\n    ${b}: ${note(ib)}`);
    }
  }
  console.log(`${n} tài khoản so được`);
  console.log(`${"".padEnd(12)} mãGT  tên+STK  thànhcông  đủ 3`);
  for (const [name, t] of [[a, tally.a], [b, tally.b]] as const)
    console.log(`${name.padEnd(12)} ${String(t.open).padEnd(5)} ${String(t.home).padEnd(8)} ${String(t.transfer).padEnd(10)} ${t.all}`);
  console.log(`\n${diffs.length} tài khoản đổi kết quả:`);
  for (const d of diffs) console.log(d);
}

const CMDS: Record<string, () => Promise<void>> = { xuat, tai, doc, so };
const fn = CMDS[cmd];
if (!fn) {
  console.log(`Lệnh lạ: ${cmd}. Có: ${Object.keys(CMDS).join(", ")}`);
  process.exit(1);
}
fn()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
