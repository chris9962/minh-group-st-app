/**
 * Ca thử cho kỳ luật **2026-11-01**, chạy cùng `bun run test:rules`.
 *
 * Chỉ thử điểm KHÁC kỳ 2026-10-15: `MSBb` về bank khác, `TCB` ra khỏi thể lệ,
 * Phòng Y cộng 0,1 cho Combo 2, Combo 3. Phần không đổi đã có ca ở
 * `test-rules-2026-10-15.ts` và các kỳ trước.
 */
import {
  bankTierFor,
  bankingPointsFor,
  comboPointsAt,
  comboRowsAt,
  giftFor,
  multiBankComboCountFor,
  openBlockReasonAt,
  openNotesAt,
  winningComboSizeAt,
  type GiftResult,
  type HouseholdKind,
  type ScoringAccount,
} from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-11-01";

const AT = "2026-11-01";
const BEFORE = "2026-10-31";
const PHONG_Y = "PHONG-Y";

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

function section(title: string): void {
  console.log(`\n  ${title}`);
}

const account = (
  customerId: string,
  bankCode: string,
  opts: { date?: string; household?: HouseholdKind; departmentCode?: string | null } = {},
): ScoringAccount => ({
  customerId,
  bankCode,
  appInstalled: true,
  openedDate: opts.date ?? AT,
  household: opts.household ?? "none",
  departmentCode: opts.departmentCode ?? null,
});

const accountsOf = (codes: string[], date = AT, departmentCode: string | null = null) =>
  codes.map((code) => account("k", code, { date, departmentCode }));

const phongY = (codes: string[], date = AT) => accountsOf(codes, date, PHONG_Y);

const points = (accounts: ScoringAccount[], yearMonth = AT.slice(0, 7)): number =>
  bankingPointsFor(accounts, yearMonth, new Map());

const gift = (accounts: ScoringAccount[], at = AT, departmentCode: string | null = null): GiftResult =>
  giftFor({ accounts, channelCodes: [], departmentCode, grantedItem: null }, at)!;

/* ── Mục 1 · hạng mới ───────────────────────────────────────────────── */

section("Hạng ngân hàng theo ngày");
check("MSBb là bank khác", bankTierFor("MSBb", AT), "other");
check("MSBb ngày 31/10 còn là bank hạn chế", bankTierFor("MSBb", BEFORE), "restricted");
check("TCB ngoài thể lệ", bankTierFor("TCB", AT), null);
check("TCB ngày 31/10 còn là bank khác", bankTierFor("TCB", BEFORE), "other");
for (const code of ["MB", "VPa", "MSBa", "TPB"]) check(`${code} vẫn là bank ưu tiên`, bankTierFor(code, AT), "priority");
for (const code of ["VPb", "SHB"]) check(`${code} vẫn là bank khác`, bankTierFor(code, AT), "other");
for (const code of ["LPB", "BIDV", "MBV", "VIB"])
  check(`${code} vẫn là bank hạn chế`, bankTierFor(code, AT), "restricted");
check("CNKD không có hạng", bankTierFor("CNKD", AT), null);
check("HKD không có hạng", bankTierFor("HKD", AT), null);

/* ── MSBb về bank khác ──────────────────────────────────────────────── */

section("MSBb là bank khác: điểm tổ hợp");
check("MSBb một mình = 0,2", comboPointsFor(["MSBb"]), 0.2);
check("MSBb + MB = 0,5", comboPointsFor(["MSBb", "MB"]), 0.5);
check("MSBb + MSBa = 0,5", comboPointsFor(["MSBb", "MSBa"]), 0.5);
check("MSBb + VPa = 0,5", comboPointsFor(["MSBb", "VPa"]), 0.5);
check("MSBb + SHB = 0,4", comboPointsFor(["MSBb", "SHB"]), 0.4);
check("MSBb + VPb = 0,4", comboPointsFor(["MSBb", "VPb"]), 0.4);
check("MSBb + LPB: về Combo 1 của MSBb", comboPointsFor(["MSBb", "LPB"]), 0.2);
check("MSBb + MB + VPa = 1,0", comboPointsFor(["MSBb", "MB", "VPa"]), 1);
check("MSBb + MB + SHB = 0,8", comboPointsFor(["MSBb", "MB", "SHB"]), 0.8);
check("MSBb + SHB + VPb = 0,7", comboPointsFor(["MSBb", "SHB", "VPb"]), 0.7);
check("MSBb + MB + LPB = 0,7", comboPointsFor(["MSBb", "MB", "LPB"]), 0.7);
check("MSBb + SHB + LPB = 0,5", comboPointsFor(["MSBb", "SHB", "LPB"]), 0.5);
check("MSBb + LPB + BIDV = 0,4", comboPointsFor(["MSBb", "LPB", "BIDV"]), 0.4);

section("MSBb: so với ngày 31/10");
check("MSBb một mình ngày 31/10 = 0", comboPointsAt(["MSBb"], BEFORE), 0);
check("MSBb + MB ngày 31/10 = 0,3", comboPointsAt(["MSBb", "MB"], BEFORE), 0.3);
check("MSBb + LPB + BIDV ngày 31/10 = 0", comboPointsAt(["MSBb", "LPB", "BIDV"], BEFORE), 0);
check("điểm KPI tháng 11, hồ sơ ngày 01/11: MSBb = 0,2", points(accountsOf(["MSBb"])), 0.2);
check(
  "điểm KPI tháng 10, hồ sơ ngày 31/10: MSBb = 0",
  points(accountsOf(["MSBb"], BEFORE), BEFORE.slice(0, 7)),
  0,
);

/* ── TCB ra khỏi thể lệ ─────────────────────────────────────────────── */

section("TCB không còn trong thể lệ");
check("TCB một mình = 0", comboPointsFor(["TCB"]), 0);
check("TCB + MB: chỉ còn Combo 1 của MB", comboPointsFor(["TCB", "MB"]), 0.3);
check("TCB + SHB: chỉ còn Combo 1 của SHB", comboPointsFor(["TCB", "SHB"]), 0.2);
check("TCB + MB + MSBa: chỉ còn MB + MSBa", comboPointsFor(["TCB", "MB", "MSBa"]), 0.7);
check("TCB + MB + VPa: còn đúng cặp VPa + MB = 0", comboPointsFor(["TCB", "MB", "VPa"]), 0);
check("TCB + MB ngày 31/10 = 0,5", comboPointsAt(["TCB", "MB"], BEFORE), 0.5);
check("TCB một mình không đủ bậc", gift(accountsOf(["TCB"])).caseCode, null);
check(
  "TCB một mình: lời giải thích nói chưa mở ngân hàng nào trong thể lệ",
  gift(accountsOf(["TCB"])).explain.some((e) => e.includes("chưa mở tài khoản nào tính được")),
  true,
);
check("TCB + MB là TH1 của Combo 1", gift(accountsOf(["TCB", "MB"])).caseCode, "TH1");
check("TCB CNKD không có điểm CNKD", points([account("k", "TCB", { household: "CNKD" })]), 0);
check("TCB HKD không có điểm HKD", points([account("k", "TCB", { household: "HKD" })]), 0);
check("TCB CNKD + MB: chỉ còn 0,3 của MB", points([account("k", "TCB", { household: "CNKD" }), account("k", "MB")]), 0.3);
check("TCB HKD + MB: chỉ còn 0,3 của MB", points([account("k", "TCB", { household: "HKD" }), account("k", "MB")]), 0.3);
check("MB CNKD + TCB: 0,3 + 1,0", points([account("k", "MB", { household: "CNKD" }), account("k", "TCB")]), 1.3);
check("đã có LPB + BIDV, mở TCB: không chặn", openBlockReasonAt(["LPB", "BIDV"], "TCB", AT), null);

/* ── Đủ 19 tổ hợp hạng với đại diện mới ─────────────────────────────── */

/** P = TPB/MB/MSBa, O = MSBb/SHB/VPb, R = LPB/BIDV/VIB. Dòng không có trong bảng ra 0. */
const TIER_POINTS: [string[], number][] = [
  [["TPB"], 0.3],
  [["MSBb"], 0.2],
  [["LPB"], 0],
  [["TPB", "MB"], 0.7],
  [["TPB", "MSBb"], 0.5],
  [["TPB", "LPB"], 0.3],
  [["MSBb", "SHB"], 0.4],
  [["MSBb", "LPB"], 0.2],
  [["LPB", "BIDV"], 0],
  [["TPB", "MB", "MSBa"], 1.2],
  [["TPB", "MB", "MSBb"], 1.0],
  [["TPB", "MB", "LPB"], 0.9],
  [["TPB", "MSBb", "SHB"], 0.8],
  [["TPB", "MSBb", "LPB"], 0.7],
  [["TPB", "LPB", "BIDV"], 0.5],
  [["MSBb", "SHB", "VPb"], 0.7],
  [["MSBb", "SHB", "LPB"], 0.5],
  [["MSBb", "LPB", "BIDV"], 0.4],
  [["LPB", "BIDV", "VIB"], 0],
];

section("19 tổ hợp hạng, đại diện TPB và MSBb");
for (const [codes, expected] of TIER_POINTS) check(codes.join(" + "), comboPointsFor(codes), expected);

/** Đổi đại diện. Không để VPa đi cùng VPb, cặp đó là dữ liệu sai. */
const SWAP: Record<string, string> = {
  TPB: "MSBa",
  MSBa: "TPB",
  MB: "VPa",
  MSBb: "SHB",
  SHB: "MSBb",
  LPB: "MBV",
  BIDV: "VIB",
  VIB: "LPB",
};
section("19 tổ hợp hạng, đại diện đổi sang MSBa, VPa, MBV");
for (const [codes, expected] of TIER_POINTS) {
  const swapped = codes.map((c) => SWAP[c] ?? c);
  check(swapped.join(" + "), comboPointsFor(swapped), expected);
}
check("bảng tổ hợp vẫn 15 dòng", (comboRowsAt(AT) ?? []).length, 15);

/* ── Quà khi có MSBb ────────────────────────────────────────────────── */

/** [tài khoản, mã TH, số năm BH, tiền]. `null` là không đủ bậc. */
const GIFT_MATRIX: [string[], string | null, 0 | 1 | 2, number][] = [
  [["MSBb"], "TH1", 1, 0],
  [["MSBb", "VPa"], "TH2", 0, 20_000],
  [["MSBb", "MSBa"], "TH3", 0, 50_000],
  [["MSBb", "MB"], "TH1", 1, 0],
  [["MSBb", "SHB"], "TH1", 1, 0],
  [["MSBb", "LPB"], "TH1", 1, 0],
  [["MSBb", "MSBa", "VPa"], "TH5", 1, 70_000],
  [["MSBb", "MSBa", "SHB"], "TH6", 1, 50_000],
  [["MSBb", "VPa", "SHB"], "TH7", 1, 20_000],
  [["MSBb", "SHB", "VPb"], "TH8", 2, 0],
  [["MSBb", "LPB", "BIDV"], "TH8", 2, 0],
];

section("Quà theo bank đặc biệt, có MSBb");
for (const [codes, code, years, cash] of GIFT_MATRIX) {
  const r = gift(accountsOf(codes));
  const name = codes.join(" + ");
  check(`${name}: ${code ?? "không đủ bậc"}`, r.caseCode, code);
  check(`${name}: ${years} năm BH`, r.insuranceYears, years);
  check(`${name}: tiền ${cash}`, r.cashTotal, cash);
}
check("MSBb + LPB là Combo 1", gift(accountsOf(["MSBb", "LPB"])).explain[0]?.includes("Tổ hợp 1 ngân hàng"), true);

/* ── Chặn lúc mở: MSBb ra khỏi trần hai bank hạn chế ────────────────── */

section("openBlockReasonAt");
const blocked = (existing: string[], candidate: string, at = AT) =>
  openBlockReasonAt(existing, candidate, at) !== null;
check("đã có LPB + BIDV, mở MSBb: mở được", blocked(["LPB", "BIDV"], "MSBb"), false);
check("đã có LPB + BIDV, mở MSBb ngày 31/10: chặn", blocked(["LPB", "BIDV"], "MSBb", BEFORE), true);
check("đã có MSBb + LPB, mở VIB: mở được", blocked(["MSBb", "LPB"], "VIB"), false);
check("đã có LPB + BIDV, mở VIB: chặn", blocked(["LPB", "BIDV"], "VIB"), true);

/* ── Phòng Y cộng 0,1 cho Combo 2, Combo 3 ──────────────────────────── */

section("Phòng Y: điểm KPI");
check("Combo 1 không cộng: MB = 0,3", points(phongY(["MB"])), 0.3);
check("Combo 2: MB + TPB = 0,8", points(phongY(["MB", "TPB"])), 0.8);
check("Combo 2: MB + MSBb = 0,6", points(phongY(["MB", "MSBb"])), 0.6);
check("Combo 2: MB + LPB = 0,4", points(phongY(["MB", "LPB"])), 0.4);
check("Combo 3: MB + TPB + MSBa = 1,3", points(phongY(["MB", "TPB", "MSBa"])), 1.3);
check("Combo 3: MSBb + LPB + BIDV = 0,5", points(phongY(["MSBb", "LPB", "BIDV"])), 0.5);
check("hạ về Combo 1: MSBb + LPB = 0,2", points(phongY(["MSBb", "LPB"])), 0.2);
check("cặp VPa + MB không cộng: 0", points(phongY(["VPa", "MB"])), 0);
check("VPa + VPb không cộng: 0", points(phongY(["VPa", "VPb", "MB"])), 0);
check(
  "Combo 2 kèm CNKD: 0,7 + 0,1 + 1,0",
  points([account("k", "MB", { departmentCode: PHONG_Y, household: "CNKD" }), account("k", "TPB", { departmentCode: PHONG_Y })]),
  1.8,
);
check(
  "hai khách Combo 2 cộng hai lần",
  points([...phongY(["MB", "TPB"]), ...["MB", "TPB"].map((c) => account("k2", c, { departmentCode: PHONG_Y }))]),
  1.6,
);
check("Phòng Dự án không cộng", points(accountsOf(["MB", "TPB"], AT, "PHONG-DU-AN")), 0.7);
check("phòng khác không cộng", points(accountsOf(["MB", "TPB"], AT, "KD1")), 0.7);
check("không có mã phòng không cộng", points(accountsOf(["MB", "TPB"])), 0.7);
check(
  "hồ sơ ngày 31/10 không cộng",
  points(phongY(["MB", "TPB"], BEFORE), BEFORE.slice(0, 7)),
  0.7,
);

section("Phòng Y: Combo 2 có tài khoản lỗi vẫn về 0");
check(
  "MB + TPB, TPB lỗi: 0",
  bankingPointsFor(phongY(["MB"]), "2026-11", new Map(), phongY(["TPB"])),
  0,
);
check(
  "MB + TPB + MSBa, MSBa lỗi: Combo 2 còn 0,8",
  bankingPointsFor(phongY(["MB", "TPB"]), "2026-11", new Map(), phongY(["MSBa"])),
  0.8,
);

section("Phòng Y: thưởng combo nhân viên điểm ATM không đổi");
check("MB + TPB đếm 1", multiBankComboCountFor(phongY(["MB", "TPB"]), "2026-11"), 1);
check("MB đếm 0", multiBankComboCountFor(phongY(["MB"]), "2026-11"), 0);

section("Phòng Y: điểm ở phần quà");
check("Combo 2 MB + TPB: điểm combo 0,8", gift(accountsOf(["MB", "TPB"]), AT, PHONG_Y).comboPoints, 0.8);
check("Combo 3 MB + TPB + MSBa: điểm combo 1,3", gift(accountsOf(["MB", "TPB", "MSBa"]), AT, PHONG_Y).comboPoints, 1.3);
check("Combo 1 MB: điểm combo 0,3", gift(accountsOf(["MB"]), AT, PHONG_Y).comboPoints, 0.3);
check("phòng khác: điểm combo 0,7", gift(accountsOf(["MB", "TPB"]), AT, "KD1").comboPoints, 0.7);
check(
  "lời giải thích nêu cộng 0,1",
  gift(accountsOf(["MB", "TPB"]), AT, PHONG_Y).explain.includes("Hồ sơ lập ở Phòng Y: Combo 2 cộng thêm 0,1 điểm."),
  true,
);
check("quà không đổi: MB + TPB vẫn TH1", gift(accountsOf(["MB", "TPB"]), AT, PHONG_Y).caseCode, "TH1");
const hasMi = (r: GiftResult) => r.basket.some((b) => b.code === "QUA-MI");
check("TH8 vẫn có Mì", hasMi(gift(accountsOf(["MB", "TPB", "MSBb"]), AT, PHONG_Y)), true);
check("TH7 vẫn không có Mì", hasMi(gift(accountsOf(["MB", "TPB", "VPa"]), AT, PHONG_Y)), false);

section("Cột ĐIỂM COMBO 2 / COMBO 3 của Excel theo tổ hợp thắng");
const comboSize = (codes: string[], at = AT) => winningComboSizeAt(accountsOf(codes, at), at);
check("SHB + LPB là Combo 1, không vào cột COMBO 2", comboSize(["SHB", "LPB"]), 1);
check("SHB + LPB ngày 31/10 cũng là Combo 1", comboSize(["SHB", "LPB"], BEFORE), 1);
check("MB + TPB là Combo 2", comboSize(["MB", "TPB"]), 2);
check("MB + TPB + MSBa là Combo 3", comboSize(["MB", "TPB", "MSBa"]), 3);
check("MB + LPB + BIDV là Combo 3", comboSize(["MB", "LPB", "BIDV"]), 3);
check("VPa + MB không thành tổ hợp", comboSize(["VPa", "MB"]), 0);
check(
  "dòng HKD không đếm: MB thường + TPB HKD là Combo 1",
  winningComboSizeAt([account("k", "MB"), account("k", "TPB", { household: "HKD" })], AT),
  1,
);

section("Câu luật ở hộp thoại mở tài khoản");
check("có câu Phòng Y cộng 0,1", openNotesAt(AT).some((note) => note.includes("Phòng Y")), true);
check("ngày 31/10 chưa có câu Phòng Y", openNotesAt(BEFORE).some((note) => note.includes("Phòng Y")), false);

/* ── Tổng kết ────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} ca đạt`);
if (failures.length > 0) {
  console.log(`  ${failures.length} ca không đạt:`);
  for (const f of failures) console.log(`    ${f}`);
  process.exit(1);
}
