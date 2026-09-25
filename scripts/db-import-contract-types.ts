import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { removeDiacritics } from "../src/lib/format";
import type { ContractType } from "../src/lib/types";
import { db } from "../src/server/db/client";
import { users } from "../src/server/db/schema";

/**
 * Nhập loại hợp đồng (HĐLĐ, HĐDV, HĐTV) vào `users.contract_type` từ file hồ sơ
 * nhân viên của phòng Kế toán. Chỉ HĐLĐ có chỉ tiêu cá nhân theo QĐ 145.
 *
 * Chạy khô, chỉ in kết quả khớp:
 *   bun run db:import-contract-types
 * Ghi thật:
 *   bun run db:import-contract-types -- --apply
 * File khác mặc định:
 *   bun run db:import-contract-types -- --file=/đường/dẫn.xlsx
 *
 * Cột "Số hợp đồng" mang mã HĐLĐ/HĐDV/HĐTV nên đọc cột đó trước. Dòng không có
 * mã thì đọc cột "Loại hợp đồng". Khớp người theo mã nhân viên, không phân
 * biệt hoa thường.
 */

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file =
  args.find((a) => a.startsWith("--file="))?.slice("--file=".length) ??
  "../HỒ_SƠ_NHÂN_VIÊN_ĐÃ_CẬP_NHẬT_HỢP_ĐỒNG.xlsx";

const plain = (text: string) => removeDiacritics(text).toUpperCase();

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

const cellText = (value: ExcelJS.CellValue): string =>
  value === null || value === undefined
    ? ""
    : typeof value === "object" && "richText" in value
      ? value.richText.map((part) => part.text).join("")
      : String(value).trim();

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];

  const header = sheet.getRow(1);
  const column = (name: string) => {
    let found = 0;
    header.eachCell((cell, index) => {
      if (plain(cellText(cell.value)).replace(/\s+/g, " ") === plain(name)) found = index;
    });
    if (!found) throw new Error(`Không thấy cột "${name}" ở dòng đầu của ${file}`);
    return found;
  };
  const codeColumn = column("Mã nhân viên");
  const numberColumn = column("Số hợp đồng");
  const kindColumn = column("Loại hợp đồng");

  const wanted = new Map<string, ContractType>();
  const unknown: string[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const code = cellText(row.getCell(codeColumn).value).toUpperCase();
    if (!code) return;
    const contract = contractOf(
      cellText(row.getCell(numberColumn).value),
      cellText(row.getCell(kindColumn).value),
    );
    if (contract) wanted.set(code, contract);
    else unknown.push(code);
  });

  const staff = await db
    .select({ id: users.id, staffCode: users.staffCode, contractType: users.contractType })
    .from(users)
    .where(sql`${users.staffCode} is not null`);

  const changes = staff.flatMap((u) => {
    const contract = wanted.get(u.staffCode!.toUpperCase());
    return contract && contract !== u.contractType ? [{ id: u.id, code: u.staffCode!, contract }] : [];
  });
  const inApp = new Set(staff.map((u) => u.staffCode!.toUpperCase()));
  const notInApp = [...wanted.keys()].filter((code) => !inApp.has(code));

  const counts = changes.reduce<Record<string, number>>(
    (sum, c) => ({ ...sum, [c.contract]: (sum[c.contract] ?? 0) + 1 }),
    {},
  );
  console.log(`File có ${wanted.size} người đọc được loại hợp đồng.`);
  console.log(`Sẽ ghi ${changes.length} người:`, counts);
  if (unknown.length) console.log(`Không đọc được loại hợp đồng (${unknown.length}):`, unknown.join(", "));
  if (notInApp.length) console.log(`Có trong file, không có trong app (${notInApp.length}):`, notInApp.join(", "));

  if (!apply) {
    console.log("Chạy khô, chưa ghi gì. Thêm --apply để ghi.");
    return;
  }
  await db.transaction(async (tx) => {
    for (const c of changes)
      await tx
        .update(users)
        .set({ contractType: c.contract, updatedAt: new Date() })
        .where(sql`${users.id} = ${c.id}`);
  });
  console.log(`Đã ghi ${changes.length} người.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
