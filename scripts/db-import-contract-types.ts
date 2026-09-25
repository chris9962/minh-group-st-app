import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { removeDiacritics } from "../src/lib/format";
import type { ContractType } from "../src/lib/types";
import { db } from "../src/server/db/client";
import { departments, staffProfiles, users } from "../src/server/db/schema";

/**
 * Nhập file hồ sơ nhân viên của phòng Kế toán vào hai chỗ:
 * - `users.contract_type` (HĐLĐ, HĐDV, HĐTV). Chỉ HĐLĐ có chỉ tiêu cá nhân theo QĐ 145.
 * - `staff_profiles`: các cột còn lại của file, nhập sẵn để dùng sau.
 *
 * Chạy khô, chỉ in kết quả khớp và danh sách còn thiếu:
 *   bun run db:import-contract-types
 * Ghi thật:
 *   bun run db:import-contract-types -- --apply
 * File khác mặc định:
 *   bun run db:import-contract-types -- --file=/đường/dẫn.xlsx
 *
 * Cột "Số hợp đồng" mang mã HĐLĐ/HĐDV/HĐTV nên đọc cột đó trước. Dòng không có
 * mã thì đọc cột "Loại hợp đồng". Khớp người theo mã nhân viên, không phân
 * biệt hoa thường. Chỉ đọc sheet đầu: sheet thứ hai là bản 5 cột của sheet đầu.
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file =
  args.find((a) => a.startsWith("--file="))?.slice("--file=".length) ??
  "../HỒ_SƠ_NHÂN_VIÊN_ĐÃ_CẬP_NHẬT_HỢP_ĐỒNG.xlsx";

const plain = (text: string) => removeDiacritics(text).toUpperCase().replace(/\s+/g, " ").trim();

function contractOf(number: string, kind: string): ContractType | null {
  const code = plain(number);
  if (code.includes("HDTV")) return "hdtv";
  if (code.includes("HDDV")) return "hddv";
  if (code.includes("HDLD")) return "hdld";
  const text = plain(kind);
  if (text.includes("THU VIEC")) return "hdtv";
  if (text.includes("DICH VU")) return "hddv";
  if (text.includes("XAC DINH THOI HAN")) return "hdld";
  return null;
}

const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "richText" in value)
    return value.richText.map((part) => part.text).join("").trim();
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  return String(value).trim();
};

/** "20/07/1998" hoặc "2026-09-13" ra "YYYY-MM-DD". Chữ khác ra null. */
function isoDate(text: string): string | null {
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = dmy
    ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
    : /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? text
      : null;
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

const orNull = (text: string) => text || null;

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
  const lastColumn = Math.max(...header.values(), sheet.columnCount);
  const c = {
    code: column("Mã nhân viên"),
    gender: column("Giới tính"),
    birth: column("Ngày sinh"),
    number: column("Số hợp đồng"),
    term: column("Thời hạn hợp đồng"),
    start: column("Ngày có hiệu lực"),
    end: column("Ngày hết hạn"),
    request: column("Ngày gửi đơn"),
    position: column("Vị trí công việc"),
    unit: column("Đơn vị công tác"),
    kind: column("Loại hợp đồng"),
    tax: column("MST cá nhân"),
    id: column("Số CCCD"),
    idOn: column("Ngày cấp"),
    idBy: column("Nơi cấp"),
    address: column("Địa chỉ hiện nay"),
    bankAccount: column("TK ngân hàng"),
    bank: column("Ngân hàng"),
    branch: column("Chi nhánh"),
    nationality: column("Quốc tich"),
    email: column("Email"),
    status: column("Trạng thái lao động"),
  };

  type Row = { contract: ContractType | null; profile: Omit<typeof staffProfiles.$inferInsert, "userId"> };
  const fileRows = new Map<string, Row>();
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const get = (col: number) => cellText(row.getCell(col).value);
    const code = get(c.code).toUpperCase();
    if (!code) return;
    fileRows.set(code, {
      contract: contractOf(get(c.number), get(c.kind)),
      profile: {
        gender: orNull(get(c.gender)),
        birthDate: isoDate(get(c.birth)),
        contractNumber: orNull(get(c.number)),
        contractTerm: orNull(get(c.term)),
        contractKind: orNull(get(c.kind)),
        contractStart: isoDate(get(c.start)),
        contractEnd: isoDate(get(c.end)),
        requestDate: isoDate(get(c.request)),
        jobPosition: orNull(get(c.position)),
        workUnit: orNull(get(c.unit)),
        taxCode: orNull(get(c.tax)),
        idNumber: orNull(get(c.id)),
        idIssuedOn: isoDate(get(c.idOn)),
        idIssuedBy: orNull(get(c.idBy)),
        address: orNull(get(c.address)),
        bankAccountNumber: orNull(get(c.bankAccount)),
        bankName: orNull(get(c.bank)),
        bankBranch: orNull(get(c.branch)),
        nationality: orNull(get(c.nationality)),
        email: orNull(get(c.email)),
        employmentStatus: orNull(get(c.status)),
        note: orNull(get(lastColumn)),
        importedAt: new Date(),
      },
    });
  });

  const staff = await db
    .select({
      id: users.id,
      staffCode: users.staffCode,
      fullName: users.fullName,
      active: users.active,
      contractType: users.contractType,
      departmentName: departments.name,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId));

  const matched = staff.flatMap((u) => {
    const row = u.staffCode ? fileRows.get(u.staffCode.toUpperCase()) : undefined;
    return row ? [{ user: u, row }] : [];
  });
  const contractChanges = matched.filter(
    (m) => m.row.contract && m.row.contract !== m.user.contractType,
  );
  const inApp = new Set(staff.flatMap((u) => (u.staffCode ? [u.staffCode.toUpperCase()] : [])));
  const notInApp = [...fileRows.keys()].filter((code) => !inApp.has(code));

  const counts = contractChanges.reduce<Record<string, number>>(
    (sum, m) => ({ ...sum, [m.row.contract!]: (sum[m.row.contract!] ?? 0) + 1 }),
    {},
  );
  console.log(`File: ${fileRows.size} người. Khớp mã nhân viên trong app: ${matched.length} người.`);
  console.log(`Ghi loại hợp đồng mới cho ${contractChanges.length} người:`, counts);
  console.log(`Ghi hồ sơ HR cho ${matched.length} người.`);
  console.log(`Có trong file, không có trong app: ${notInApp.length} người.`);

  // Người ĐANG LÀM sau lượt nhập vẫn chưa có loại hợp đồng, kèm lý do.
  const missing = staff
    .filter((u) => u.active)
    .flatMap((u) => {
      const row = u.staffCode ? fileRows.get(u.staffCode.toUpperCase()) : undefined;
      if (row?.contract || u.contractType) return [];
      const reason = !u.staffCode
        ? "chưa có mã nhân viên"
        : !row
          ? "mã không có trong file"
          : "file không ghi loại hợp đồng";
      return [{ ...u, reason }];
    })
    .sort((a, b) => (a.departmentName ?? "").localeCompare(b.departmentName ?? ""));
  console.log(`\nNhân viên đang làm CHƯA có loại hợp đồng sau lượt nhập: ${missing.length} người`);
  for (const u of missing)
    console.log(`- ${u.staffCode ?? "(không mã)"} | ${u.fullName} | ${u.departmentName ?? "không phòng"} | ${u.reason}`);

  if (!apply) {
    console.log("\nChạy khô, chưa ghi gì. Thêm --apply để ghi.");
    return;
  }
  await db.transaction(async (tx) => {
    for (const m of contractChanges)
      await tx
        .update(users)
        .set({ contractType: m.row.contract, updatedAt: new Date() })
        .where(eq(users.id, m.user.id));
    for (const m of matched)
      await tx
        .insert(staffProfiles)
        .values({ userId: m.user.id, ...m.row.profile })
        .onConflictDoUpdate({ target: staffProfiles.userId, set: m.row.profile });
  });
  console.log(`\nĐã ghi ${contractChanges.length} loại hợp đồng và ${matched.length} hồ sơ HR.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
