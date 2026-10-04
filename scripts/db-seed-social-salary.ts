import { eq, sql } from "drizzle-orm";
import { SOCIAL_DEPARTMENT_CODE } from "../src/lib/api/staff";
import { SALARY_SCHEME_LABEL, type SalaryScheme } from "../src/lib/types";
import { db } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { recomputeForSalaryScheme } from "../src/server/kpi";

/**
 * Đặt cách tính lương cho Phòng An Sinh (spec docs/spec-bhyt-bhxh-an-sinh.md
 * mục 5, migration 0125): nhân viên sang `social`, Trưởng phòng và Phó phòng
 * sang `fixed` kèm số tiền.
 *
 * Thông báo lương của Phòng An Sinh không ghi lương cứng của Trưởng phòng, Phó
 * phòng, nên số tiền đi bằng tham số `--salary=<tên đăng nhập>:<số đồng>`. Người
 * quản lý không có tham số thì script bỏ qua, đặt sau ở form nhân viên.
 *
 * Chạy khô để xem trước, không ghi gì:
 *   bun run db:seed-social-salary
 *
 * Ghi thật thì BẮT BUỘC khai người chịu trách nhiệm:
 *   bun run db:seed-social-salary -- --apply --as=admin --salary=021phuongtk:12000000
 *
 * Chạy lại được: người đã đúng cách tính và đúng số tiền thì bỏ qua.
 */

type Change = { id: string; name: string; from: SalaryScheme; to: "social" | "fixed"; amount: number | null };

const MAX_FIXED_SALARY = 2_000_000_000;
const label = (c: Change) =>
  `${SALARY_SCHEME_LABEL[c.from]} sang ${SALARY_SCHEME_LABEL[c.to]}${c.amount ? ` ${c.amount.toLocaleString("vi-VN")}đ` : ""}`;

async function main() {
  const apply = process.argv.includes("--apply");
  const asArg = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "";
  const salaries = new Map(
    process.argv
      .filter((a) => a.startsWith("--salary="))
      .map((a) => {
        const [username, amount] = a.slice(9).split(":");
        return [username.trim().toLowerCase(), Number(amount)] as const;
      }),
  );
  for (const [username, amount] of salaries)
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_FIXED_SALARY)
      throw new Error(`Số tiền của ${username} phải là số nguyên đồng, từ 1 tới 2.000.000.000.`);

  // Lương và điểm KPI chỉ tính cho phòng loại kinh doanh: phòng khác thì đổi cách tính lương cũng ra 0đ.
  const department = await db.execute<{ type: string }>(
    sql`select type from departments where code = ${SOCIAL_DEPARTMENT_CODE}`,
  );
  if (department.rows[0]?.type !== "sales")
    throw new Error(`Phòng ${SOCIAL_DEPARTMENT_CODE} chưa là loại kinh doanh. Đổi loại phòng ở P-91 rồi chạy lại.`);

  const people = await db.execute<{
    id: string;
    username: string;
    full_name: string;
    role: string;
    salary_scheme: SalaryScheme;
    fixed_salary: number | null;
  }>(sql`
    select u.id, u.username, u.full_name, u.role, u.salary_scheme, u.fixed_salary
    from users u
    join departments d on d.id = u.department_id and d.code = ${SOCIAL_DEPARTMENT_CODE}
    where u.active
    order by u.role, u.full_name
  `);

  const changes: Change[] = [];
  const skipped: string[] = [];
  for (const p of people.rows) {
    if (p.role === "staff") {
      if (p.salary_scheme !== "social")
        changes.push({ id: p.id, name: p.full_name, from: p.salary_scheme, to: "social", amount: null });
      continue;
    }
    const amount = salaries.get(p.username.toLowerCase());
    if (!amount) {
      if (p.salary_scheme !== "fixed") skipped.push(`${p.full_name} (${p.username})`);
      continue;
    }
    if (p.salary_scheme !== "fixed" || p.fixed_salary !== amount)
      changes.push({ id: p.id, name: p.full_name, from: p.salary_scheme, to: "fixed", amount });
  }

  const managers = new Set(people.rows.filter((p) => p.role !== "staff").map((p) => p.username.toLowerCase()));
  for (const username of salaries.keys())
    if (!managers.has(username))
      console.warn(`Bỏ qua --salary=${username}: không phải Trưởng phòng, Phó phòng đang làm ở Phòng An Sinh.`);

  if (skipped.length > 0)
    console.log(`Chưa có số tiền lương cứng, bỏ qua:\n${skipped.map((s) => `  ${s}`).join("\n")}`);
  if (changes.length === 0) {
    console.log("Không có ai cần đổi cách tính lương.");
    process.exit(0);
  }

  console.log(`${changes.length} người sắp đổi cách tính lương${apply ? "" : " (CHẠY KHÔ, không ghi gì)"}:`);
  for (const c of changes)
    console.log(`  ${c.name}: ${label(c)}`);
  if (!apply) process.exit(0);

  if (!asArg) throw new Error("Thiếu --as=<tên đăng nhập>. Đổi cách tính lương đổi số tiền lương, phải có người chịu trách nhiệm.");
  const actor = await db.execute<{ id: string }>(sql`select id from users where username = ${asArg} and active limit 1`);
  const actorId = actor.rows[0]?.id;
  if (!actorId) throw new Error(`Không tìm thấy tài khoản đang hoạt động nào có tên đăng nhập "${asArg}".`);

  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx
        .update(users)
        .set({ salaryScheme: c.to, fixedSalary: c.amount, updatedAt: new Date() })
        .where(eq(users.id, c.id));
      await tx.execute(sql`
        insert into audit_log (actor_id, module, action, target_label, target_table, target_id)
        values (
          ${actorId}, 'staff'::module_key, 'update'::action_key,
          ${`db:seed-social-salary đổi cách tính lương của ${c.name} từ ${label(c)}`},
          'users', ${c.id}
        )
      `);
    }
  });
  // Cùng việc `updateStaff` làm khi đổi cách tính lương trên form.
  for (const c of changes) await recomputeForSalaryScheme(c.id);
  console.log("Đổi xong, đã ghi nhật ký truy vết.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
