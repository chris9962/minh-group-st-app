/**
 * Ca thử cho kỳ lương **2026-11**, chạy cùng `bun run test:rules`.
 *
 * Chỉ thử điểm KHÁC kỳ 2026-10: chỉ tiêu tài khoản định hướng vẫn chấm và hiện
 * số đạt, nhưng không cộng không trừ điểm hay tiền (chủ dự án chốt 2026-11-12).
 */
import { salaryRulesFor, type SalaryResult } from "../src/rules/salary";

type Value = number | boolean | string | null | undefined;

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: Value, expected: Value): void {
  if (Object.is(actual, expected)) {
    passed += 1;
    return;
  }
  failures.push(`${name}\n      mong ${expected} · nhận ${actual}`);
}

const fact = (result: SalaryResult, label: string) => result.facts.find((f) => f.label === label)?.value;
const item = (result: SalaryResult, label: string) => result.items.find((i) => i.label === label);

const nov = salaryRulesFor("2026-11")!;
const oct = salaryRulesFor("2026-10")!;

// Nhân viên HĐLĐ
const staffBase = { points: 120, workDays: 26, scheme: "department" as const };
const noQuota = nov.staff(staffBase);
const short = nov.staff({ ...staffBase, directedQuota: { target: 50, achieved: 49 } });
const reached = nov.staff({ ...staffBase, directedQuota: { target: 50, achieved: 50 } });
check("NV thiếu định hướng: lương bằng lúc không có chỉ tiêu", short.amount, noQuota.amount);
check("NV đạt định hướng: lương bằng lúc không có chỉ tiêu", reached.amount, noQuota.amount);
check("NV thiếu định hướng: câu chấm", fact(short, "Tài khoản định hướng"), "49/50, thiếu 2%, không cộng không trừ");
check("NV đạt định hướng: câu chấm", fact(reached, "Tài khoản định hướng"), "50/50, đạt, không cộng không trừ");
check("NV không CASA: không có dòng Điểm tính lương", fact(short, "Điểm tính lương"), undefined);

const withCasa = nov.staff({ ...staffBase, directedQuota: { target: 50, achieved: 10 }, casaAccounts: 5 });
check("NV có CASA: Điểm tính lương chỉ cộng CASA", fact(withCasa, "Điểm tính lương"), "121 điểm");
check("NV có CASA: CASA vẫn cộng 0,2 điểm mỗi tài khoản", fact(withCasa, "Tài khoản CASA"), "5 tài khoản, cộng 1 điểm");

const octShort = oct.staff({ ...staffBase, directedQuota: { target: 50, achieved: 49 } });
check("Kỳ 2026-10 giữ luật trừ: Điểm tính lương", fact(octShort, "Điểm tính lương"), "118 điểm");

// Trưởng phòng
const managerBase = { role: "head" as const, points: 30, teamPoints: [120, 90], workDays: 26 };
const hkd = { target: 20, achieved: 18 };
const managerNoDirected = nov.manager({ ...managerBase, departmentQuota: { hkd, directed: null } });
const managerShort = nov.manager({ ...managerBase, departmentQuota: { hkd, directed: { target: 50, achieved: 45 } } });
const managerReached = nov.manager({ ...managerBase, departmentQuota: { hkd, directed: { target: 50, achieved: 60 } } });
check("TP thiếu định hướng phòng: lương bằng lúc không có chỉ tiêu", managerShort.amount, managerNoDirected.amount);
check("TP đạt định hướng phòng: lương bằng lúc không có chỉ tiêu", managerReached.amount, managerNoDirected.amount);
check("TP thiếu định hướng phòng: dòng 0đ", item(managerShort, "Chỉ tiêu định hướng của phòng")?.amount, 0);
check(
  "TP thiếu định hướng phòng: câu chấm",
  item(managerShort, "Chỉ tiêu định hướng của phòng")?.formula,
  "45/50, thiếu 10%, không cộng không trừ",
);
check("TP thiếu định hướng phòng: dòng vẫn hiện khi 0đ", item(managerShort, "Chỉ tiêu định hướng của phòng")?.keepAtZero, true);
check("TP: chỉ tiêu HKD phòng vẫn trừ", item(managerShort, "Chỉ tiêu HKD của phòng")?.amount, -10 * 120_000);

// Phó giám đốc
const deputyBase = { teamPoints: [120], members: [{ points: 120, target: 100 }], branchPoints: 500 };
const deputyNoDirected = nov.deputyDirector!({
  ...deputyBase,
  departmentQuotas: [{ hkd: { target: 10, achieved: 12 }, directed: null }],
});
const deputyMixed = nov.deputyDirector!({
  ...deputyBase,
  departmentQuotas: [
    { hkd: { target: 10, achieved: 12 }, directed: { target: 50, achieved: 60 } },
    { hkd: null, directed: { target: 50, achieved: 20 } },
  ],
});
check("PGĐ: định hướng các phòng không đổi lương", deputyMixed.amount, deputyNoDirected.amount);
check("PGĐ: dòng định hướng 0đ", item(deputyMixed, "Chỉ tiêu định hướng các phòng")?.amount, 0);
check(
  "PGĐ: câu chấm định hướng",
  item(deputyMixed, "Chỉ tiêu định hướng các phòng")?.formula,
  "1 phòng đạt - 1 phòng thiếu, không cộng không trừ",
);
check("PGĐ: chỉ tiêu HKD vẫn cộng", item(deputyMixed, "Chỉ tiêu HKD các phòng")?.amount, 10 * 150_000);

if (failures.length > 0) {
  console.error(`Lương 2026-11: ${failures.length} ca sai, ${passed} ca đúng`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`Lương 2026-11: ${passed} ca đúng`);
