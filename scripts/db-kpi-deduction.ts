import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { formatPoints, roundPoints } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { kpiAdjustments } from "../src/server/db/schema";
import { notify } from "../src/server/notifications";

/**
 * Trừ điểm KPI hàng loạt theo file Excel: mỗi mã nhân viên một dòng
 * `kpi_adjustments` điểm âm vào tháng chỉ định, rồi báo cho người đó.
 *
 * Sheet phải có dòng tiêu đề chứa cột "MÃ NHÂN VIÊN" và "ĐIỂM TRỪ". Cột "KHÔNG
 * GHI NHẬN" có thì câu thông báo ghi kèm số tài khoản. Lần đầu dùng cho sheet
 * "ĐIỂM TRỪ T08" của báo cáo VPBa tháng 08, ghi vào tháng 2026-09 (chốt
 * 2026-10-16).
 *
 * Ghi vào `--month`, không phải tháng hiện tại như form ở P-52: điểm trừ thường
 * thuộc tháng lương chưa chốt trước đó, và phải ghi trước khi chốt lương tháng đó.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:kpi-deduction -- --file=/root/bao-cao.xlsx --sheet="ĐIỂM TRỪ T08" \
 *     --month=2026-09 --reason="điểm trừ lỗi VPBa tháng 08 không ghi nhận đủ giao dịch khác ngày"
 *
 * Ghi thật thì thêm `--apply --as=<tên đăng nhập>` để có người chịu trách nhiệm.
 *
 * ⚠️ Chỉ `--apply` trên máy chủ. Database local là bản dump production kèm khoá
 * push thật, ghi ở local là đẩy tin tới điện thoại thật của nhân viên.
 *
 * Chạy lại được: người đã có dòng cùng tháng, cùng lý do thì bỏ qua, không trừ
 * và không báo lần hai.
 */

type Deduction = { code: string; points: number; accounts: number | null };
type Person = { id: string; username: string; full_name: string; active: boolean };

const argOf = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3).trim() ?? "";

const numberOf = (value: ExcelJS.CellValue): number => {
  const raw = value && typeof value === "object" && "result" in value ? value.result : value;
  return typeof raw === "number" ? raw : Number(raw ?? 0);
};
const textOf = (value: ExcelJS.CellValue): string => String(value ?? "").trim();

async function readDeductions(file: string, sheetName: string): Promise<Deduction[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`File không có sheet "${sheetName}".`);

  let headerRow = 0;
  const column: Record<string, number> = {};
  sheet.eachRow((row, rowNumber) => {
    if (headerRow) return;
    const titles = (row.values as ExcelJS.CellValue[]).map(textOf);
    if (!titles.includes("MÃ NHÂN VIÊN")) return;
    headerRow = rowNumber;
    titles.forEach((title, index) => (column[title] = index));
  });
  for (const title of ["MÃ NHÂN VIÊN", "ĐIỂM TRỪ"])
    if (!headerRow || !column[title]) throw new Error(`Sheet "${sheetName}" thiếu cột "${title}".`);
  const accountsColumn = column["KHÔNG GHI NHẬN"];

  // Một mã có thể đứng ở hai phòng (342NHUHB ở báo cáo VPBa T08): cộng dồn thành một lần trừ.
  const byCode = new Map<string, Deduction>();
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const code = textOf(row.getCell(column["MÃ NHÂN VIÊN"]).value);
    if (!code) break;
    const current = byCode.get(code.toLowerCase()) ?? { code, points: 0, accounts: accountsColumn ? 0 : null };
    current.points = roundPoints(current.points + numberOf(row.getCell(column["ĐIỂM TRỪ"]).value));
    if (accountsColumn) current.accounts = (current.accounts ?? 0) + numberOf(row.getCell(accountsColumn).value);
    byCode.set(code.toLowerCase(), current);
  }
  return [...byCode.values()];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const asArg = argOf("as");
  const file = argOf("file");
  const sheetName = argOf("sheet");
  const month = argOf("month");
  const reason = argOf("reason");
  if (!file) throw new Error("Thiếu --file=<đường dẫn file Excel>.");
  if (!sheetName) throw new Error('Thiếu --sheet="<tên sheet có bảng điểm trừ>".');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Thiếu hoặc sai --month=YYYY-MM.");
  if (reason.length < 2) throw new Error('Thiếu --reason="<lý do ghi vào điểm cộng và thông báo>".');
  const monthText = `${month.slice(5)}/${month.slice(0, 4)}`;

  const deductions = (await readDeductions(file, sheetName)).filter((d) => d.points > 0);
  if (deductions.length === 0) {
    console.log(`Sheet "${sheetName}" không có mã nào bị trừ điểm.`);
    process.exit(0);
  }
  const codes = deductions.map((d) => d.code.toLowerCase());

  const people = await db.execute<Person>(sql`
    select id, username, full_name, active from users
    where lower(username) in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
  `);
  const personOf = new Map(people.rows.map((p) => [p.username.toLowerCase(), p]));

  const applied = await db.execute<{ user_id: string }>(sql`
    select user_id from kpi_adjustments where year_month = ${month} and reason = ${reason}
  `);
  const done = new Set(applied.rows.map((r) => r.user_id));

  const missing = deductions.filter((d) => !personOf.has(d.code.toLowerCase()));
  const already = deductions.filter((d) => done.has(personOf.get(d.code.toLowerCase())?.id ?? ""));
  const todo = deductions
    .map((d) => ({ ...d, person: personOf.get(d.code.toLowerCase()) }))
    .filter((d): d is Deduction & { person: Person } => !!d.person && !done.has(d.person.id));

  const total = (list: { points: number }[]) => formatPoints(roundPoints(list.reduce((s, d) => s + d.points, 0)));
  console.log(`Tháng ghi: ${month}. Lý do: "${reason}".`);
  console.log(`Sheet có ${deductions.length} mã bị trừ điểm, tổng ${total(deductions)} điểm.`);
  if (missing.length > 0)
    console.log(
      `Không có tài khoản trên app, bỏ qua ${missing.length} mã, ${total(missing)} điểm:\n` +
        missing.map((d) => `  ${d.code}: ${formatPoints(d.points)}`).join("\n"),
    );
  if (already.length > 0) console.log(`Đã trừ ở lần chạy trước, bỏ qua ${already.length} người.`);
  if (todo.length === 0) {
    console.log("Không còn ai cần trừ điểm.");
    process.exit(0);
  }

  const inactive = todo.filter((d) => !d.person.active);
  console.log(
    `${todo.length} người sắp bị trừ, tổng ${total(todo)} điểm${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}:\n` +
      todo
        .map((d) => `  ${d.person.full_name} (${d.code}): -${formatPoints(d.points)}${d.person.active ? "" : ", đã nghỉ"}`)
        .join("\n"),
  );
  if (inactive.length > 0)
    console.log(`Trong đó ${inactive.length} người đã nghỉ: vẫn trừ điểm, không gửi thông báo.`);
  if (!apply) process.exit(0);

  if (!asArg) throw new Error("Thiếu --as=<tên đăng nhập>. Trừ điểm KPI đổi lương, phải có người chịu trách nhiệm.");
  const actor = await db.execute<{ id: string }>(sql`select id from users where username = ${asArg} and active limit 1`);
  const actorId = actor.rows[0]?.id;
  if (!actorId) throw new Error(`Không tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);

  await db.transaction(async (tx) => {
    for (const d of todo) {
      const [row] = await tx
        .insert(kpiAdjustments)
        .values({
          userId: d.person.id,
          yearMonth: month,
          points: (-d.points).toFixed(2),
          reason,
          createdBy: actorId,
        })
        .returning({ id: kpiAdjustments.id });
      // Cùng nhãn với route cộng điểm ở P-52, để màn nhật ký đọc như một lần trừ tay.
      await tx.execute(sql`
        insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
        values (
          ${actorId}, 'system'::module_key, 'adjust-kpi'::action_key,
          ${`Trừ ${formatPoints(d.points)} điểm KPI tháng ${month} cho ${d.person.full_name}`},
          'kpi_adjustments', ${row.id}
        )
      `);
    }
  });
  console.log(`Đã ghi ${todo.length} dòng điểm trừ và nhật ký truy vết.`);

  // Gửi sau khi transaction xong: thông báo không được đi trước điểm đã ghi.
  let sent = 0;
  for (const d of todo.filter((t) => t.person.active)) {
    const accounts = d.accounts === null ? "" : ` cho ${d.accounts} tài khoản`;
    const ok = await notify(d.person.id, "announcement", {
      title: `Đã tính lại điểm KPI tháng ${monthText}`,
      body: `Điểm KPI tháng ${monthText} của bạn bị trừ ${formatPoints(d.points)} điểm${accounts}. Lý do: ${reason}.`,
    });
    if (ok) sent++;
  }
  console.log(`Đã gửi thông báo cho ${sent} người.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
