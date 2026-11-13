import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { removeDiacritics } from "../src/lib/format";
import { db } from "../src/server/db/client";
import { staffProfiles, users } from "../src/server/db/schema";

/**
 * Ghi số tài khoản, ngân hàng nhận và mã ngân hàng của nhân viên từ file
 * `banks-nhanvien-co-ma.xlsx` (kế toán gửi 2026-11-13) vào `staff_profiles`.
 * File Lương và file Tạm ứng đọc ba cột này.
 *
 * Chạy khô, chỉ in kết quả khớp và các dòng bị bỏ:
 *   bun run db:import-staff-banks
 * Ghi thật:
 *   bun run db:import-staff-banks -- --apply
 * File khác mặc định:
 *   bun run db:import-staff-banks -- --file=/đường/dẫn.xlsx
 *
 * Khớp người theo mã nhân viên, không phân biệt hoa thường. Tên trong file khác
 * tên trong app thì bỏ dòng đó: mã gõ sai sẽ chuyển lương vào tài khoản người khác.
 * Số tài khoản bỏ hết khoảng trắng. Ô mã ngân hàng trống thì ghi null.
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file =
  args.find((a) => a.startsWith("--file="))?.slice("--file=".length) ?? "../banks-nhanvien-co-ma.xlsx";

const plain = (text: string) => removeDiacritics(text).toUpperCase().replace(/\s+/g, " ").trim();

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value)
    return value.richText.map((part) => part.text).join("").trim();
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  return String(value).trim();
};

type FileRow = { line: number; code: string; name: string; account: string; bank: string | null; bankCode: string | null };

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];

  const header = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, index) => header.set(plain(cellText(cell.value)), index));
  const column = (name: string) => {
    const found = header.get(plain(name));
    if (!found) throw new Error(`Không thấy cột "${name}" ở dòng đầu của ${file}`);
    return found;
  };
  const c = {
    code: column("Mã nhân viên"),
    name: column("Tên có dấu"),
    account: column("Số tài khoản"),
    bank: column("Ngân hàng nhận"),
    bankCode: column("Mã ngân hàng"),
  };

  const fileRows: FileRow[] = [];
  sheet.eachRow((row, line) => {
    if (line === 1) return;
    const get = (col: number) => cellText(row.getCell(col).value);
    const code = get(c.code).toUpperCase();
    if (!code) return;
    fileRows.push({
      line,
      code,
      name: get(c.name),
      account: get(c.account).replace(/\s+/g, ""),
      bank: get(c.bank) || null,
      bankCode: get(c.bankCode) || null,
    });
  });

  const seen = new Map<string, number>();
  const duplicated = fileRows.filter((r) => {
    const first = seen.get(r.code);
    seen.set(r.code, first ?? r.line);
    return first !== undefined;
  });
  if (duplicated.length > 0) {
    for (const r of duplicated) console.log(`- Trùng mã ${r.code}: dòng ${seen.get(r.code)} và dòng ${r.line}`);
    throw new Error("File có mã nhân viên trùng. Sửa file rồi chạy lại.");
  }

  const staff = await db
    .select({
      id: users.id,
      staffCode: users.staffCode,
      fullName: users.fullName,
      active: users.active,
      account: staffProfiles.bankAccountNumber,
      bank: staffProfiles.bankName,
      bankCode: staffProfiles.bankCode,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id));
  const byCode = new Map(staff.flatMap((u) => (u.staffCode ? [[u.staffCode.toUpperCase(), u] as const] : [])));

  const notInApp: FileRow[] = [];
  const nameMismatch: { row: FileRow; appName: string }[] = [];
  const noAccount: FileRow[] = [];
  const changes: { row: FileRow; user: (typeof staff)[number] }[] = [];
  let unchanged = 0;
  for (const row of fileRows) {
    const user = byCode.get(row.code);
    if (!user) {
      notInApp.push(row);
      continue;
    }
    if (plain(row.name) !== plain(user.fullName)) {
      nameMismatch.push({ row, appName: user.fullName });
      continue;
    }
    if (!row.account) {
      noAccount.push(row);
      continue;
    }
    if (user.account === row.account && user.bank === row.bank && user.bankCode === row.bankCode) unchanged++;
    else changes.push({ row, user });
  }

  const inFile = new Set(fileRows.map((r) => r.code));
  const activeMissing = staff.filter((u) => u.active && u.staffCode && !inFile.has(u.staffCode.toUpperCase()));

  console.log(`File: ${fileRows.length} dòng có mã nhân viên.`);
  console.log(`Ghi mới hoặc đổi: ${changes.length} người. Giữ nguyên: ${unchanged} người.`);
  console.log(`Bỏ qua: ${notInApp.length + nameMismatch.length + noAccount.length} dòng.`);

  console.log(`\nMã không có trong app: ${notInApp.length}`);
  for (const r of notInApp) console.log(`- dòng ${r.line} | ${r.code} | ${r.name}`);
  console.log(`\nTên trong file khác tên trong app: ${nameMismatch.length}`);
  for (const m of nameMismatch) console.log(`- dòng ${m.row.line} | ${m.row.code} | file: ${m.row.name} | app: ${m.appName}`);
  console.log(`\nKhông có số tài khoản: ${noAccount.length}`);
  for (const r of noAccount) console.log(`- dòng ${r.line} | ${r.code} | ${r.name}`);
  console.log(`\nNhân viên đang làm không có trong file: ${activeMissing.length}`);
  for (const u of activeMissing) console.log(`- ${u.staffCode} | ${u.fullName}`);

  console.log(`\nThay đổi (cũ -> mới):`);
  for (const { row, user } of changes)
    console.log(
      `- ${row.code} | ${user.account ?? "-"} ${user.bank ?? "-"} ${user.bankCode ?? "-"} -> ${row.account} ${row.bank ?? "-"} ${row.bankCode ?? "-"}`,
    );

  if (!apply) {
    console.log("\nChạy khô, chưa ghi gì. Thêm --apply để ghi.");
    return;
  }
  await db.transaction(async (tx) => {
    for (const { row, user } of changes) {
      const bank = { bankAccountNumber: row.account, bankName: row.bank, bankCode: row.bankCode };
      await tx
        .insert(staffProfiles)
        .values({ userId: user.id, ...bank })
        .onConflictDoUpdate({ target: staffProfiles.userId, set: bank });
    }
  });
  console.log(`\nĐã ghi tài khoản nhận lương cho ${changes.length} người.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
