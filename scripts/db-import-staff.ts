import { hashSync } from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { ROLE_PERMISSIONS } from "../src/lib/roles";
import type { RoleKey } from "../src/lib/types";
import * as schema from "../src/server/db/schema";

/**
 * Nhập danh sách nhân sự đang làm việc từ file HR của công ty vào bảng `users`.
 *
 * Nguồn là JSON do `scripts/xlsx-to-staff-json.py` sinh ra từ sheet thứ hai của
 * "DANH SÁCH NHÂN SỰ MGST.xlsx" — sheet đó chỉ có người đang làm việc. Sheet
 * thứ nhất (442 người, gồm cả người đã nghỉ) KHÔNG dùng làm nguồn, chỉ dùng để
 * tra số điện thoại.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:import-staff -- --dry-run
 *
 * Ghi thật thì BẮT BUỘC khai tên đăng nhập của người chịu trách nhiệm — nó vào
 * `audit_log` để tháng sau còn tra được tài khoản tới từ đâu:
 *   bun run db:import-staff -- --as=admin
 *
 * Đặt lại mật khẩu mặc định cho những người đã nhập lần trước:
 *   bun run db:import-staff -- --as=admin --reset-passwords
 *
 * ⚠️ Ba điều phải biết trước khi chạy thật:
 *
 * 1. **Mọi người nhận CHUNG mật khẩu `12345678`** (chốt 2026-08-22). Đội phát
 *    một lần cho cả công ty, từng người tự đổi ở màn Hồ sơ. Cho tới lúc họ đổi
 *    thì ai biết mã nhân viên của người khác cũng đăng nhập được — app chưa có
 *    màn bắt buộc đổi mật khẩu lần đầu.
 * 2. **Phó Giám đốc và Cố vấn nhập vào sẽ thấy 0 bản ghi.** Chức vụ đó mang
 *    `manageScope = 'listed'`, mà file HR không nói họ quản phòng nào, nên danh
 *    sách phòng quản rỗng và `recordVisibility` trả `none`. Phải gán phòng quản
 *    tay ở P-53 sau khi nhập.
 * 3. **Nhân viên phòng Dự Án không có `wardId`.** File HR không có cột ấp/xã.
 *
 * Idempotent: chạy lại không tạo trùng. Mã nhân viên là khoá so khớp, và cũng
 * là tên đăng nhập — `001THAODV` đăng nhập bằng `001thaodv`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "data/staff-import.json");

/**
 * Mật khẩu khởi tạo chung, giống bộ seed. Không sinh ngẫu nhiên: 283 mật khẩu
 * riêng thì đội phát phải chuyển từng chuỗi tới từng người, và mọi chuỗi phải
 * nằm trong một file đọc được cho tới lúc phát xong.
 */
const DEFAULT_PASSWORD = "12345678";

type SourcePerson = {
  staffCode: string;
  username: string;
  fullName: string;
  position: string;
  department: string;
  status: string;
  phone: string;
};

/**
 * Tên phòng trong file HR → mã phòng trong `departments`.
 *
 * Tra theo MÃ chứ không theo tên vì tên sửa được ở P-91. Tên bên file HR cũng
 * không khớp tên trong app: HR ghi "Phòng Kinh Doanh Y", app ghi "Phòng Y".
 * "Ban giám đốc" có hai cách viết hoa trong cùng một file.
 */
const DEPARTMENT_CODE: Record<string, string | null> = {
  "Ban giám đốc": null,
  "Ban Giám đốc": null,
  "Phòng An Sinh": "PHONG-AN-SINH",
  "Phòng Kinh Doanh Y": "PHONG-Y",
  "Phòng Kế toán Tổng hợp": "PHONG-KTTH",
  "Phòng Kinh doanh Tổng hợp": "PHONG-KDTH",
  "Phòng Dự Án": "PHONG-DU-AN",
  "Phòng Bảo trợ xã hội": "PHONG-BTXH",
  "Phòng Kinh Doanh 1": "KD-1",
  "Phòng Kinh Doanh 2": "KD-2",
  "Phòng Kinh Doanh 3": "KD-3",
  "Phòng Kinh Doanh 4": "KD-4",
  "Phòng Kinh Doanh 5": "KD-5",
  "Phòng Kinh Doanh 6": "KD-6",
  "Phòng Kinh Doanh 7": "KD-7",
  "Phòng Kinh Doanh 8": "KD-8",
  "Phòng Kinh Doanh 9": "KD-9",
};

/**
 * Vị trí công việc trong file HR → chức vụ trong app.
 *
 * "Dịch vụ" là 216 người ký hợp đồng dịch vụ, không phải nhân viên biên chế.
 * Họ vẫn nhận chức vụ `staff` vì công việc trên app giống hệt: nhập khách, mở
 * tài khoản, tạo đơn. Không cấp tài khoản cho nhóm này thì phải lọc trước khi
 * chạy, script không tự đoán.
 */
const ROLE_OF_POSITION: Record<string, RoleKey> = {
  "Giám đốc": "director",
  "Phó Giám đốc": "deputy-director",
  "Quyền Phó Giám Đốc": "deputy-director",
  "Cố vấn Cao cấp": "deputy-director",
  "Cố vấn chuyên môn": "deputy-director",
  "Trưởng Phòng Kinh Doanh": "head",
  "Trưởng phòng An Sinh": "head",
  "Trưởng phòng Dự Án": "head",
  "Trưởng phòng Kế toán Tổng hợp": "head",
  "Trưởng phòng Kinh doanh Tổng hợp": "head",
  "Phó phòng kinh doanh": "deputy-head",
  "Phó Phòng Kế toán Tổng hợp": "deputy-head",
  "Dịch vụ": "staff",
  "Chuyên viên kinh doanh": "staff",
  "Chuyên viên chuyển đổi số": "staff",
  "Chuyên viên Phòng Kế toán Tổng hợp": "staff",
  "Kế toán": "staff",
};

/**
 * Số điện thoại thay thế cho người file HR bỏ trống. Cột `phone` không cho
 * trống, mà bỏ qua cả người thì hồ sơ thiếu — dễ thấy hơn là thiếu hẳn dòng.
 */
const PHONE_PLACEHOLDER = "0000000000";

const arg = (name: string): string | null => {
  const found = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!found) return null;
  const [, value] = found.split("=");
  return value ?? "";
};

async function main() {
  const dryRun = arg("dry-run") !== null;
  const actorUsername = arg("as");
  /**
   * Đặt lại mật khẩu về mặc định cho người ĐÃ có trong database, thay vì bỏ qua
   * họ. Dành cho lượt nhập trước đó lỡ cấp mật khẩu ngẫu nhiên. Không bật mặc
   * định: chạy lại lệnh nhập không được vô tình đặt lại mật khẩu người đang dùng.
   */
  const resetPasswords = arg("reset-passwords") !== null;
  if (!dryRun && !actorUsername)
    throw new Error(
      "Ghi thật phải khai người chịu trách nhiệm: --as=<tên đăng nhập>. Xem trước thì --dry-run",
    );

  // `pg` không báo lỗi khi thiếu biến này — nó chuyển sang localhost:5432 và
  // script đổ dữ liệu vào NHẦM database mà không ai biết.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL chưa đặt — tạo .env.local từ .env.example rồi chạy lại");

  const people: SourcePerson[] = JSON.parse(readFileSync(SOURCE, "utf8"));
  const working = people.filter((p) => p.status === "Đang làm việc");
  if (working.length !== people.length)
    console.log(`Bỏ qua ${people.length - working.length} người không ở trạng thái đang làm việc`);

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    const actor = actorUsername
      ? (
          await db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.username, actorUsername))
        )[0]
      : null;
    if (actorUsername && !actor) throw new Error(`Không có tài khoản nào tên "${actorUsername}"`);

    const departmentIdByCode = new Map(
      (await db.select().from(schema.departments)).map((d) => [d.code, d.id]),
    );

    /** Mã phòng sai thì DỪNG HẲN — bỏ qua thì cả phòng rơi vào "không thuộc đâu". */
    const departmentIdOf = (name: string): string | null => {
      if (!(name in DEPARTMENT_CODE)) throw new Error(`Chưa có ánh xạ cho đơn vị "${name}"`);
      const code = DEPARTMENT_CODE[name];
      if (code === null) return null;
      const id = departmentIdByCode.get(code);
      if (!id) throw new Error(`Database không có phòng nào mã "${code}" (đơn vị "${name}")`);
      return id;
    };

    const roleOf = (position: string): RoleKey => {
      const role = ROLE_OF_POSITION[position];
      if (!role) throw new Error(`Chưa có ánh xạ chức vụ cho vị trí "${position}"`);
      return role;
    };

    const existing = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        staffCode: schema.users.staffCode,
        fullName: schema.users.fullName,
      })
      .from(schema.users);
    const byStaffCode = new Map(existing.filter((u) => u.staffCode).map((u) => [u.staffCode!, u]));
    const usernameTaken = new Set(existing.map((u) => u.username));
    /**
     * Database dựng trước 2026-08-22 có sáu tài khoản Ban giám đốc mang mã TẠM
     * `TMP-*`; `scripts/seed-data.ts` từ đó đã mang mã thật nên bản dựng mới
     * không còn dòng nào như vậy. Nhánh này vá cho những database cũ: khớp theo
     * HỌ TÊN và chỉ sửa mã — dựng người thứ hai cho cùng một con người là hai hồ
     * sơ chia đôi điểm KPI. Quyền và phòng quản đã chỉnh tay, script không đụng.
     */
    const temporaryByName = new Map(
      existing.filter((u) => u.staffCode?.startsWith("TMP-")).map((u) => [u.fullName, u]),
    );

    const passwordHash = hashSync(DEFAULT_PASSWORD, 10);
    const created: { staffCode: string; username: string; fullName: string }[] = [];
    const patched: { staffCode: string; username: string; fullName: string }[] = [];
    const reset: string[] = [];
    const skipped: { staffCode: string; fullName: string; reason: string }[] = [];
    const noPhone: string[] = [];
    const needsManagedDepartments: string[] = [];

    for (const person of working) {
      const already = byStaffCode.get(person.staffCode);
      if (already) {
        if (!resetPasswords) {
          skipped.push({ ...person, reason: "mã nhân viên đã có trong database" });
          continue;
        }
        reset.push(`${person.staffCode} · ${person.fullName}`);
        if (!dryRun)
          await db
            .update(schema.users)
            .set({ passwordHash, updatedAt: new Date() })
            .where(eq(schema.users.id, already.id));
        continue;
      }

      const temporary = temporaryByName.get(person.fullName);
      if (temporary) {
        patched.push({
          staffCode: person.staffCode,
          username: temporary.username,
          fullName: person.fullName,
        });
        if (!dryRun)
          await db
            .update(schema.users)
            .set({ staffCode: person.staffCode, updatedAt: new Date() })
            .where(eq(schema.users.id, temporary.id));
        byStaffCode.set(person.staffCode, { ...temporary, staffCode: person.staffCode });
        temporaryByName.delete(person.fullName);
        continue;
      }

      if (usernameTaken.has(person.username)) {
        skipped.push({ ...person, reason: `tên đăng nhập "${person.username}" đã có người dùng` });
        continue;
      }

      const role = roleOf(person.position);
      const departmentId = departmentIdOf(person.department);
      // Hai trục tổ chức suy từ chức vụ, cùng luật với `normalizeStaffForm`:
      // trưởng và phó phòng quản đúng phòng mình thuộc về, giám đốc quản cả
      // công ty, nhân viên không quản ai.
      const managedDepartmentIds =
        (role === "head" || role === "deputy-head") && departmentId ? [departmentId] : [];
      const manageScope =
        role === "director" ? "company" : role === "staff" ? "none" : ("listed" as const);
      if (manageScope === "listed" && managedDepartmentIds.length === 0)
        needsManagedDepartments.push(`${person.staffCode} · ${person.fullName}`);

      const phone = person.phone || PHONE_PLACEHOLDER;
      if (!person.phone) noPhone.push(`${person.staffCode} · ${person.fullName}`);

      created.push({
        staffCode: person.staffCode,
        username: person.username,
        fullName: person.fullName,
      });
      usernameTaken.add(person.username);

      if (dryRun) continue;

      // Người + quyền + phòng quản trong MỘT transaction — không có nửa người.
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.users)
          .values({
            username: person.username,
            staffCode: person.staffCode,
            passwordHash,
            fullName: person.fullName,
            phone,
            role,
            title: person.position,
            departmentId,
            manageScope,
          })
          .returning({ id: schema.users.id });

        const permissions = ROLE_PERMISSIONS[role];
        if (permissions.length > 0)
          await tx.insert(schema.userPermissions).values(
            permissions.map((p) => ({
              userId: row.id,
              module: p.module,
              action: p.action,
              scope: p.scope,
            })),
          );

        if (managedDepartmentIds.length > 0)
          await tx
            .insert(schema.userManagedDepartments)
            .values(managedDepartmentIds.map((id) => ({ userId: row.id, departmentId: id })));

        if (actor)
          await tx.insert(schema.auditLog).values({
            actorId: actor.id,
            module: "staff",
            action: "create",
            targetLabel: `${person.fullName} (${person.staffCode})`,
            targetTable: "users",
            targetId: row.id,
          });
      });
    }

    const label = dryRun ? "[chạy khô] " : "";
    console.log(`\n${label}Nguồn: ${working.length} người đang làm việc`);
    console.log(`${label}Tạo mới: ${created.length}`);
    console.log(`${label}Vá mã nhân viên cho tài khoản đã có: ${patched.length}`);
    for (const p of patched) console.log(`    ${p.username} · ${p.fullName} → ${p.staffCode}`);
    if (resetPasswords) console.log(`${label}Đặt lại mật khẩu mặc định: ${reset.length}`);
    console.log(`${label}Bỏ qua: ${skipped.length}`);
    for (const s of skipped) console.log(`    ${s.staffCode} · ${s.fullName} — ${s.reason}`);

    if (noPhone.length > 0) {
      console.log(
        `\n⚠️  ${noPhone.length} người không có số điện thoại, đang mang ${PHONE_PLACEHOLDER} — sửa ở P-52:`,
      );
      for (const x of noPhone) console.log(`    ${x}`);
    }
    if (needsManagedDepartments.length > 0) {
      console.log(
        `\n⚠️  ${needsManagedDepartments.length} người chức vụ Phó Giám đốc / Cố vấn chưa có phòng quản.`,
      );
      console.log("    Chưa gán phòng quản ở P-53 thì họ mở màn nào cũng thấy 0 bản ghi:");
      for (const x of needsManagedDepartments) console.log(`    ${x}`);
    }
    if (created.length > 0 || reset.length > 0)
      console.log(
        `\nMật khẩu khởi tạo của mọi người: ${DEFAULT_PASSWORD}. Nhắc từng người tự đổi ở màn Hồ sơ.`,
      );
    if (dryRun) console.log("\nChưa ghi gì. Ghi thật thì chạy lại với --as=<tên đăng nhập>.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
