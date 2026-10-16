import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { readImage } from "../src/server/storage";

/**
 * Sao lưu TRỌN một tài khoản ngân hàng ra thư mục đọc được bằng mắt, trước khi
 * xoá khỏi hệ thống.
 *
 *   bun --env-file=.env.local scripts/backup-bank-account.ts <accountId> [thư-mục]
 *
 * Ra ba thứ: `du-lieu.json` giữ nguyên mọi cột, `anh/` chứa ảnh tải từ kho, và
 * `doc-toi-day.html` mở bằng trình duyệt xem được cả chữ lẫn ảnh.
 *
 * Script chỉ ĐỌC. Nó không xoá gì; xoá là việc làm sau, bằng tay.
 */
const [accountId, outArg] = process.argv.slice(2);
if (!accountId) throw new Error("Thiếu accountId. Xem chú thích đầu file.");

const root = outArg || path.join(process.cwd(), "..", `backup-tai-khoan-${accountId.slice(0, 8)}`);
const imagesDir = path.join(root, "anh");
await mkdir(imagesDir, { recursive: true });

const rows = async (query: string, params: unknown[] = []) =>
  (await db.execute(sql.raw(query.replace(/\$1/g, `'${String(params[0] ?? accountId)}'`)))).rows as Record<string, unknown>[];

const data = {
  xuat_luc: new Date().toISOString(),
  account_id: accountId,
  tai_khoan: await rows(`
    select a.*, b.code as bank_code
    from bank_accounts a join banks b on b.id = a.bank_id where a.id = $1`),
  khach_hang: await rows(`
    select c.* from customers c
    join bank_accounts a on a.customer_id = c.id where a.id = $1`),
  ma_gioi_thieu: await rows(`
    select r.* from referral_codes r
    join bank_accounts a on a.referral_code_id = r.id where a.id = $1`),
  nguoi_tao: await rows(`
    select u.id, u.full_name, u.username, u.role, u.department_id from users u
    join bank_accounts a on a.created_by = u.id where a.id = $1`),
  phong_ban: await rows(`
    select d.* from departments d
    join users u on u.department_id = d.id
    join bank_accounts a on a.created_by = u.id where a.id = $1`),
  anh: await rows(`select * from bank_account_photos where account_id = $1 order by kind, sort_order`),
  lich_su_trang_thai: await rows(`
    select h.*, u.full_name as nguoi_doi from bank_account_status_history h
    left join users u on u.id = h.changed_by
    where h.account_id = $1 order by h.changed_at`),
  luot_kiem_anh: await rows(`
    select c.*, u.full_name as nguoi_xac_nhan from bank_account_checks c
    left join users u on u.id = c.confirmed_by
    where c.account_id = $1 order by c.created_at`),
  cac_tai_khoan_khac_cua_khach: await rows(`
    select a2.id, a2.account_number, a2.status, a2.opened_date, b.code as bank_code
    from bank_accounts a2 join banks b on b.id = a2.bank_id
    where a2.customer_id = (select customer_id from bank_accounts where id = $1)
      and a2.id <> $1 order by a2.created_at`),
};

await writeFile(path.join(root, "du-lieu.json"), JSON.stringify(data, null, 2));

/* ── Tải ảnh ─────────────────────────────────────────────────────────── */

const anhTai: { file: string; kind: string; url: string; ok: boolean }[] = [];
for (const [at, photo] of data.anh.entries()) {
  const key = String(photo.url);
  const file = `${String(at + 1).padStart(2, "0")}-${photo.kind}${path.extname(key) || ".webp"}`;
  try {
    const stored = await readImage(key);
    if (!stored) throw new Error("kho ảnh không trả dữ liệu");
    const body = stored.body instanceof ArrayBuffer
      ? Buffer.from(stored.body)
      : Buffer.from(await new Response(stored.body).arrayBuffer());
    await writeFile(path.join(imagesDir, file), body);
    anhTai.push({ file, kind: String(photo.kind), url: key, ok: true });
  } catch (error) {
    console.warn(`Không tải được ${key}: ${error instanceof Error ? error.message : String(error)}`);
    anhTai.push({ file, kind: String(photo.kind), url: key, ok: false });
  }
}

/* ── Trang đọc bằng mắt ──────────────────────────────────────────────── */

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const bang = (title: string, list: Record<string, unknown>[]): string => {
  if (!list.length) return `<h2>${esc(title)}</h2><p>Không có dòng nào.</p>`;
  const cols = [...new Set(list.flatMap((r) => Object.keys(r)))];
  return `<h2>${esc(title)} <small>${list.length} dòng</small></h2>
<div class="cuon"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${list.map((r) => `<tr>${cols.map((c) => {
    const v = r[c];
    const s = v && typeof v === "object" ? JSON.stringify(v, null, 1) : String(v ?? "");
    return `<td>${esc(s)}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;
};

const tk = data.tai_khoan[0] ?? {};
const kh = data.khach_hang[0] ?? {};
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Sao lưu tài khoản ${esc(tk.account_number)}</title>
<style>
 body{font-family:system-ui,sans-serif;margin:24px;max-width:1200px;color:#1a1a1a}
 h1{font-size:22px} h2{font-size:17px;margin-top:32px;border-bottom:1px solid #ddd;padding-bottom:6px}
 small{font-weight:400;color:#666}
 .cuon{overflow-x:auto} table{border-collapse:collapse;font-size:12px;width:100%}
 th,td{border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top;white-space:pre-wrap;word-break:break-word}
 th{background:#f4f4f4;position:sticky;top:0}
 .tom{background:#f8f8f8;padding:14px 16px;border:1px solid #ddd;border-radius:6px}
 .tom div{margin:3px 0}
 .anh{display:flex;flex-wrap:wrap;gap:14px;margin-top:12px}
 .anh figure{margin:0;width:260px} .anh img{width:100%;border:1px solid #ccc;border-radius:4px}
 .anh figcaption{font-size:12px;color:#555;margin-top:4px;word-break:break-all}
</style></head><body>
<h1>Sao lưu tài khoản ${esc(tk.account_number)} — ${esc(kh.full_name)}</h1>
<div class="tom">
 <div><b>Mã tài khoản trong hệ thống:</b> ${esc(accountId)}</div>
 <div><b>Ngân hàng:</b> ${esc(tk.bank_code)}</div>
 <div><b>Số tài khoản:</b> ${esc(tk.account_number)}</div>
 <div><b>Khách hàng:</b> ${esc(kh.full_name)}</div>
 <div><b>Ngày mở:</b> ${esc(tk.opened_date)}</div>
 <div><b>Trạng thái:</b> ${esc(tk.status)}</div>
 <div><b>Người tạo:</b> ${esc(data.nguoi_tao[0]?.full_name)}</div>
 <div><b>Mã giới thiệu:</b> ${esc(data.ma_gioi_thieu[0]?.code)}</div>
 <div><b>Xuất lúc:</b> ${esc(data.xuat_luc)}</div>
</div>
<h2>Ảnh <small>${anhTai.filter((a) => a.ok).length}/${anhTai.length} tải được</small></h2>
<div class="anh">${anhTai.map((a) => a.ok
  ? `<figure><img src="anh/${esc(a.file)}" alt="${esc(a.kind)}"><figcaption>${esc(a.file)}<br>${esc(a.url)}</figcaption></figure>`
  : `<figure><figcaption>KHÔNG TẢI ĐƯỢC<br>${esc(a.url)}</figcaption></figure>`).join("")}</div>
${bang("Tài khoản", data.tai_khoan)}
${bang("Khách hàng", data.khach_hang)}
${bang("Mã giới thiệu", data.ma_gioi_thieu)}
${bang("Người tạo", data.nguoi_tao)}
${bang("Phòng ban của người tạo", data.phong_ban)}
${bang("Ảnh — dòng trong database", data.anh)}
${bang("Lịch sử trạng thái", data.lich_su_trang_thai)}
${bang("Các lượt kiểm ảnh", data.luot_kiem_anh)}
${bang("Tài khoản khác của cùng khách", data.cac_tai_khoan_khac_cua_khach)}
</body></html>`;

await writeFile(path.join(root, "doc-toi-day.html"), html);

console.log(`Xong. Thư mục: ${root}`);
console.log(`  du-lieu.json        ${Object.keys(data).length} nhóm dữ liệu`);
console.log(`  anh/                ${anhTai.filter((a) => a.ok).length}/${anhTai.length} ảnh`);
console.log(`  doc-toi-day.html    mở bằng trình duyệt`);
process.exit(0);
