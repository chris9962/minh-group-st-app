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
check("Tháng 2026-12 dùng kỳ 2026-11", salaryRulesFor("2026-12") === nov, true);

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

const socialBase = { points: 120, workDays: 22, scheme: "social" as const };
const socialShort = nov.staff({ ...socialBase, directedQuota: { target: 50, achieved: 20 } });
check("NV An Sinh thiếu định hướng: lương không đổi", socialShort.amount, nov.staff(socialBase).amount);
check("NV An Sinh thiếu định hướng: câu chấm", fact(socialShort, "Tài khoản định hướng"), "20/50, thiếu 60%, không cộng không trừ");

const atmBase = { points: 120, workDays: 22, scheme: "atm" as const };
const atmShort = nov.staff({ ...atmBase, directedQuota: { target: 50, achieved: 20 } });
check("NV ATM: định hướng không đổi lương", atmShort.amount, nov.staff(atmBase).amount);

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
  "1 phòng đạt, 1 phòng thiếu, không cộng không trừ",
);
check("PGĐ: chỉ tiêu HKD vẫn cộng", item(deputyMixed, "Chỉ tiêu HKD các phòng")?.amount, 10 * 150_000);

// Trần ngày công của phòng có chấm công (chốt 2026-11-16), áp cả kỳ 2026-10
const meal = (result: SalaryResult) => item(result, "Hỗ trợ ăn ca")?.amount;
for (const [month, rules] of [["2026-10", oct], ["2026-11", nov]] as const) {
  check(`${month} ATM không trần phòng: cắt 22`, meal(rules.staff({ ...atmBase, workDays: 30 })), 22 * 120_000);
  check(`${month} ATM trần phòng 26: cắt 26`, meal(rules.staff({ ...atmBase, workDays: 30, maxWorkDays: 26 })), 26 * 120_000);
  check(`${month} ATM trần phòng 27, 24 ngày công: 24`, meal(rules.staff({ ...atmBase, workDays: 24, maxWorkDays: 27 })), 24 * 120_000);
  check(`${month} An Sinh trần phòng 27: cắt 27`, meal(rules.staff({ ...socialBase, workDays: 30, maxWorkDays: 27 })), 27 * 120_000);
  check(`${month} NV kinh doanh trần phòng 27: cắt 27`, meal(rules.staff({ ...staffBase, workDays: 30, maxWorkDays: 27 })), 27 * 120_000);
  check(`${month} NV kinh doanh không trần phòng: cắt 26`, meal(rules.staff({ ...staffBase, workDays: 30 })), 26 * 120_000);
  check(`${month} Trưởng phòng trần phòng 27: cắt 27`, meal(rules.manager({ ...managerBase, workDays: 30, maxWorkDays: 27 })), 27 * 120_000);
  check(`${month} Lương cứng trần phòng 26: cắt 26`, meal(rules.fixed!({ amount: 5_000_000, workDays: 30, maxWorkDays: 26 })), 26 * 120_000);
  check(`${month} Lương cứng không trần phòng: cắt 22`, meal(rules.fixed!({ amount: 5_000_000, workDays: 30 })), 22 * 120_000);
  check(`${month} NV kinh doanh nửa ngày công: dấu phẩy`, fact(rules.staff({ ...staffBase, workDays: 20.5 }), "Ngày công"), "20,5 ngày");
  check(`${month} Trưởng phòng nửa ngày công: dấu phẩy`, item(rules.manager({ ...managerBase, workDays: 20.5 }), "Hỗ trợ ăn ca")?.formula, "20,5 ngày × 120.000đ");
}

// Lương ăn ca (chốt 2026-11-20): ăn ca nằm ngoài phép cắt về 0, số ngày lấy từ màn Lương ăn ca
const deepShort = { ...managerBase, teamPoints: [], points: 0, departmentQuota: { hkd: { target: 100, achieved: 0 }, directed: null } };
check("TP các khoản khác âm: lương = ăn ca", nov.manager(deepShort).amount, 26 * 120_000);
check("Kỳ 2026-10 giữ phép cắt về 0 cả ăn ca", oct.manager(deepShort).amount, 0);
const edited = nov.staff({ ...staffBase, workDays: 26, mealDays: 20.5 });
check("Số ngày sửa thay ngày công: tiền ăn ca", meal(edited), 20.5 * 120_000);
check("Số ngày sửa thay ngày công: ô Ngày công", fact(edited, "Ngày công"), "20,5 ngày");
check("Số ngày sửa không cắt trần", meal(nov.staff({ ...atmBase, workDays: 10, mealDays: 25 })), 25 * 120_000);
check("Số app tính cắt trần", nov.staff({ ...atmBase, workDays: 30 }).meal?.appDays, 22);
check("Số app tính giữ khi có số sửa", nov.staff({ ...atmBase, workDays: 30, mealDays: 5 }).meal?.appDays, 22);
check("Trần trả kèm: trần phòng", nov.manager({ ...managerBase, maxWorkDays: 27 }).meal?.maxDays, 27);
check("Lương cứng có dòng ăn ca", nov.fixed!({ amount: 5_000_000, workDays: 3 }).meal?.appDays, 3);
check("PGĐ số ngày 0: không có tiền ăn ca", meal(nov.deputyDirector!({ ...deputyBase, mealDays: 0 })), 0);
check("PGĐ số app tính 22", nov.deputyDirector!(deputyBase).meal?.appDays, 22);
check("Kỳ 2026-10 không trả thông tin ăn ca", oct.staff(staffBase).meal === undefined, true);
check("Đơn giá ăn ca kỳ 2026-11", nov.mealRate, 120_000);
check("Kỳ 2026-10 không có đơn giá ăn ca", oct.mealRate, undefined);

if (failures.length > 0) {
  console.error(`Lương 2026-11: ${failures.length} ca sai, ${passed} ca đúng`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`Lương 2026-11: ${passed} ca đúng`);
