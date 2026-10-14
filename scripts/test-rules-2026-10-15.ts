/**
 * Ca thử cho kỳ luật **2026-10-15**, chạy cùng `bun run test:rules`.
 *
 * Chỉ thử điểm KHÁC kỳ 2026-10-11: `TPB` lên bank ưu tiên, `MSBb` xuống bank
 * hạn chế, bỏ ngoại lệ `TPB` + `LPB`. Phần không đổi đã có ca ở
 * `test-rules-2026-10-01.ts` và `test-rules-2026-10-11.ts`.
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
  type GiftResult,
  type HouseholdKind,
  type ScoringAccount,
} from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-10-15";

const AT = "2026-10-15";
const BEFORE = "2026-10-14";

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
  opts: { date?: string; household?: HouseholdKind } = {},
): ScoringAccount => ({
  customerId,
  bankCode,
  appInstalled: true,
  openedDate: opts.date ?? AT,
  household: opts.household ?? "none",
});

const accountsOf = (codes: string[], date = AT) => codes.map((code) => account("k", code, { date }));

const points = (accounts: ScoringAccount[], yearMonth = "2026-10"): number =>
  bankingPointsFor(accounts, yearMonth, new Map());

const gift = (accounts: ScoringAccount[], at = AT, departmentCode: string | null = null): GiftResult =>
  giftFor({ accounts, channelCodes: [], departmentCode, grantedItem: null }, at)!;

/* ── Mục 1 · hạng mới ───────────────────────────────────────────────── */

section("Hạng ngân hàng theo ngày");
check("TPB là bank ưu tiên", bankTierFor("TPB", AT), "priority");
check("TPB ngày 14/10 còn là bank khác", bankTierFor("TPB", BEFORE), "other");
check("MSBb là bank hạn chế", bankTierFor("MSBb", AT), "restricted");
check("MSBb ngày 14/10 còn là bank khác", bankTierFor("MSBb", BEFORE), "other");
for (const code of ["MB", "VPa", "MSBa"]) check(`${code} vẫn là bank ưu tiên`, bankTierFor(code, AT), "priority");
for (const code of ["VPb", "TCB", "SHB"]) check(`${code} vẫn là bank khác`, bankTierFor(code, AT), "other");
for (const code of ["LPB", "BIDV", "MBV", "VIB"])
  check(`${code} vẫn là bank hạn chế`, bankTierFor(code, AT), "restricted");
check("CNKD không có hạng", bankTierFor("CNKD", AT), null);
check("HKD không có hạng", bankTierFor("HKD", AT), null);

/* ── TPB lên bank ưu tiên ───────────────────────────────────────────── */

section("TPB là bank ưu tiên: điểm tổ hợp");
check("TPB một mình = 0,3", comboPointsFor(["TPB"]), 0.3);
check("TPB + MB = 0,7", comboPointsFor(["TPB", "MB"]), 0.7);
check("TPB + VPa = 0,7, không phải cặp VPa + MB", comboPointsFor(["TPB", "VPa"]), 0.7);
check("TPB + MSBa = 0,7", comboPointsFor(["TPB", "MSBa"]), 0.7);
check("TPB + TCB = 0,5", comboPointsFor(["TPB", "TCB"]), 0.5);
check("TPB + VPb = 0,5", comboPointsFor(["TPB", "VPb"]), 0.5);
check("TPB + LPB = 0,3 theo bảng", comboPointsFor(["TPB", "LPB"]), 0.3);
check("TPB + BIDV = 0,3, hết hạ về Combo 1", comboPointsFor(["TPB", "BIDV"]), 0.3);
check("TPB + VIB = 0,3", comboPointsFor(["TPB", "VIB"]), 0.3);
check("TPB + MBV = 0,3", comboPointsFor(["TPB", "MBV"]), 0.3);
check("TPB + MSBb = 0,3", comboPointsFor(["TPB", "MSBb"]), 0.3);
check("TPB + MB + VPa = 1,2", comboPointsFor(["TPB", "MB", "VPa"]), 1.2);
check("TPB + MB + MSBa = 1,2", comboPointsFor(["TPB", "MB", "MSBa"]), 1.2);
check("TPB + MB + TCB = 1,0", comboPointsFor(["TPB", "MB", "TCB"]), 1);
check("TPB + MB + LPB = 0,9", comboPointsFor(["TPB", "MB", "LPB"]), 0.9);
check("TPB + TCB + SHB = 0,8", comboPointsFor(["TPB", "TCB", "SHB"]), 0.8);
check("TPB + TCB + LPB = 0,7", comboPointsFor(["TPB", "TCB", "LPB"]), 0.7);
check("TPB + LPB + BIDV = 0,5", comboPointsFor(["TPB", "LPB", "BIDV"]), 0.5);

section("TPB: so với ngày 14/10");
check("TPB một mình ngày 14/10 = 0,2", comboPointsAt(["TPB"], BEFORE), 0.2);
check("TPB + MB ngày 14/10 = 0,5", comboPointsAt(["TPB", "MB"], BEFORE), 0.5);
check("TPB + BIDV ngày 14/10 = 0,2", comboPointsAt(["TPB", "BIDV"], BEFORE), 0.2);
check("TPB + TCB + SHB ngày 14/10 = 0,7", comboPointsAt(["TPB", "TCB", "SHB"], BEFORE), 0.7);
check("điểm KPI tháng 10, hồ sơ ngày 15/10: TPB = 0,3", points(accountsOf(["TPB"])), 0.3);
check("điểm KPI tháng 10, hồ sơ ngày 14/10: TPB = 0,2", points(accountsOf(["TPB"], BEFORE)), 0.2);
check("hai khách hai kỳ cộng đúng", points([account("a", "TPB"), account("b", "TPB", { date: BEFORE })]), 0.5);

/* ── MSBb xuống bank hạn chế ────────────────────────────────────────── */

section("MSBb là bank hạn chế: điểm tổ hợp");
check("MSBb một mình = 0", comboPointsFor(["MSBb"]), 0);
check("MSBb + MB = 0,3", comboPointsFor(["MSBb", "MB"]), 0.3);
check("MSBb + MSBa = 0,3", comboPointsFor(["MSBb", "MSBa"]), 0.3);
check("MSBb + VPa = 0,3", comboPointsFor(["MSBb", "VPa"]), 0.3);
check("MSBb + TCB: về Combo 1 của TCB", comboPointsFor(["MSBb", "TCB"]), 0.2);
check("MSBb + VPb: về Combo 1 của VPb", comboPointsFor(["MSBb", "VPb"]), 0.2);
check("MSBb + SHB: về Combo 1 của SHB", comboPointsFor(["MSBb", "SHB"]), 0.2);
check("MSBb + LPB: hai hạn chế = 0", comboPointsFor(["MSBb", "LPB"]), 0);
check("MSBb + BIDV: hai hạn chế = 0", comboPointsFor(["MSBb", "BIDV"]), 0);
check("MSBb + MB + VPa = 0,9", comboPointsFor(["MSBb", "MB", "VPa"]), 0.9);
check("MSBb + MB + TCB = 0,7", comboPointsFor(["MSBb", "MB", "TCB"]), 0.7);
check("MSBb + TCB + SHB = 0,5", comboPointsFor(["MSBb", "TCB", "SHB"]), 0.5);
check("MSBb + MB + LPB = 0,5", comboPointsFor(["MSBb", "MB", "LPB"]), 0.5);
check("MSBb + TCB + LPB = 0,4", comboPointsFor(["MSBb", "TCB", "LPB"]), 0.4);
check("MSBb + LPB + BIDV: ba hạn chế = 0", comboPointsFor(["MSBb", "LPB", "BIDV"]), 0);

section("MSBb: so với ngày 14/10");
check("MSBb một mình ngày 14/10 = 0,2", comboPointsAt(["MSBb"], BEFORE), 0.2);
check("MSBb + MB ngày 14/10 = 0,5", comboPointsAt(["MSBb", "MB"], BEFORE), 0.5);
check("MSBb + TCB ngày 14/10 = 0,4", comboPointsAt(["MSBb", "TCB"], BEFORE), 0.4);
check("MSBb + LPB ngày 14/10 = 0,2", comboPointsAt(["MSBb", "LPB"], BEFORE), 0.2);
check("MSBb + LPB + BIDV ngày 14/10 = 0,4", comboPointsAt(["MSBb", "LPB", "BIDV"], BEFORE), 0.4);
check("điểm KPI tháng 10, hồ sơ ngày 15/10: MSBb = 0", points(accountsOf(["MSBb"])), 0);
check("điểm KPI tháng 10, hồ sơ ngày 14/10: MSBb = 0,2", points(accountsOf(["MSBb"], BEFORE)), 0.2);

/* ── Bỏ ngoại lệ TPB + LPB ──────────────────────────────────────────── */

section("TPB + LPB: cùng kết quả, không còn là ngoại lệ");
check("TPB + LPB = 0,3", comboPointsFor(["TPB", "LPB"]), 0.3);
check("LPB + TPB thứ tự ngược = 0,3", comboPointsFor(["LPB", "TPB"]), 0.3);
check("ngày 14/10 vẫn 0,3 nhờ ngoại lệ kỳ trước", comboPointsAt(["TPB", "LPB"], BEFORE), 0.3);
const pair = gift(accountsOf(["TPB", "LPB"]));
check("TPB + LPB: TH1", pair.caseCode, "TH1");
check("TPB + LPB: 01 năm BH", pair.insuranceYears, 1);
check("TPB + LPB: không có tiền mặt", pair.cashTotal, 0);
check("TPB + LPB: là Combo 2", pair.explain[0]?.includes("Tổ hợp 2 ngân hàng"), true);
check(
  "bảng tổ hợp hết dòng ngoại lệ",
  (comboRowsAt(AT) ?? []).some((row) => row.label === "TPB + LPB (ngoại lệ)"),
  false,
);
check(
  "ngày 14/10 bảng vẫn có dòng ngoại lệ",
  (comboRowsAt(BEFORE) ?? []).some((row) => row.label === "TPB + LPB (ngoại lệ)"),
  true,
);
check("bảng tổ hợp có 15 dòng", (comboRowsAt(AT) ?? []).length, 15);
check("câu luật hết nhắc TPB + LPB", openNotesAt(AT).some((note) => note.includes("TPB + LPB")), false);
check(
  "câu luật nói Combo 2 chỉ 1 ưu tiên + 1 hạn chế",
  openNotesAt(AT).some((note) => note.includes("chỉ 1 ưu tiên + 1 hạn chế")),
  true,
);

section("Bank khác + bank hạn chế vẫn về Combo 1 của bank khác");
check("VPb + LPB = 0,2", comboPointsFor(["VPb", "LPB"]), 0.2);
check("TCB + BIDV = 0,2", comboPointsFor(["TCB", "BIDV"]), 0.2);
check("SHB + VIB = 0,2", comboPointsFor(["SHB", "VIB"]), 0.2);
check("SHB + MSBb = 0,2", comboPointsFor(["SHB", "MSBb"]), 0.2);
check("TCB + LPB là TH1 của Combo 1", gift(accountsOf(["TCB", "LPB"])).caseCode, "TH1");
check(
  "TCB + LPB là Combo 1",
  gift(accountsOf(["TCB", "LPB"])).explain[0]?.includes("Tổ hợp 1 ngân hàng"),
  true,
);

/* ── Đủ 19 tổ hợp hạng với đại diện mới ─────────────────────────────── */

/** P = TPB/MB/MSBa, O = TCB/SHB/VPb, R = MSBb/LPB/BIDV. Dòng không có trong bảng ra 0. */
const TIER_POINTS: [string[], number][] = [
  [["TPB"], 0.3],
  [["TCB"], 0.2],
  [["MSBb"], 0],
  [["TPB", "MB"], 0.7],
  [["TPB", "TCB"], 0.5],
  [["TPB", "MSBb"], 0.3],
  [["TCB", "SHB"], 0.4],
  [["TCB", "MSBb"], 0.2],
  [["MSBb", "LPB"], 0],
  [["TPB", "MB", "MSBa"], 1.2],
  [["TPB", "MB", "TCB"], 1.0],
  [["TPB", "MB", "MSBb"], 0.9],
  [["TPB", "TCB", "SHB"], 0.8],
  [["TPB", "TCB", "MSBb"], 0.7],
  [["TPB", "MSBb", "LPB"], 0.5],
  [["TCB", "SHB", "VPb"], 0.7],
  [["TCB", "SHB", "MSBb"], 0.5],
  [["TCB", "MSBb", "LPB"], 0.4],
  [["MSBb", "LPB", "BIDV"], 0],
];

section("19 tổ hợp hạng, đại diện TPB và MSBb");
for (const [codes, expected] of TIER_POINTS) check(codes.join(" + "), comboPointsFor(codes), expected);

/**
 * Đổi đại diện: MSBa thay TPB, VPa thay MB, VIB thay MSBb, MBV thay LPB, LPB
 * thay BIDV; TCB và SHB đổi chỗ. Không để VPa đi cùng VPb, cặp đó là dữ liệu sai.
 */
const SWAP: Record<string, string> = {
  TPB: "MSBa",
  MSBa: "TPB",
  MB: "VPa",
  TCB: "SHB",
  SHB: "TCB",
  MSBb: "VIB",
  LPB: "MBV",
  BIDV: "LPB",
};
section("19 tổ hợp hạng, đại diện đổi sang MSBa, VPa, VIB");
for (const [codes, expected] of TIER_POINTS) {
  const swapped = codes.map((c) => SWAP[c] ?? c);
  check(swapped.join(" + "), comboPointsFor(swapped), expected);
}

/* ── Quà theo bank đặc biệt khi có TPB, MSBb ────────────────────────── */

/** [tài khoản, mã TH, số năm BH, tiền]. `null` là không đủ bậc. */
const GIFT_MATRIX: [string[], string | null, 0 | 1 | 2, number][] = [
  [["TPB"], "TH1", 1, 0],
  [["MSBb"], null, 0, 0],
  [["TPB", "VPa"], "TH2", 0, 20_000],
  [["TPB", "MSBa"], "TH3", 0, 50_000],
  [["TPB", "MB"], "TH1", 1, 0],
  [["TPB", "TCB"], "TH1", 1, 0],
  [["TPB", "LPB"], "TH1", 1, 0],
  [["TPB", "MSBb"], "TH1", 1, 0],
  [["MSBb", "VPa"], "TH2", 0, 20_000],
  [["MSBb", "MSBa"], "TH3", 0, 50_000],
  [["MSBb", "MB"], "TH1", 1, 0],
  [["MSBb", "TCB"], "TH1", 1, 0],
  [["MSBb", "LPB"], null, 0, 0],
  [["TPB", "VPa", "MSBa"], "TH5", 1, 70_000],
  [["TPB", "MB", "MSBa"], "TH6", 1, 50_000],
  [["TPB", "MB", "VPa"], "TH7", 1, 20_000],
  [["TPB", "VPa", "LPB"], "TH7", 1, 20_000],
  [["TPB", "MB", "TCB"], "TH8", 2, 0],
  [["TPB", "MB", "MSBb"], "TH8", 2, 0],
  [["TPB", "MSBb", "LPB"], "TH8", 2, 0],
  [["MSBb", "MSBa", "VPa"], "TH5", 1, 70_000],
  [["MSBb", "MSBa", "TCB"], "TH6", 1, 50_000],
  [["MSBb", "VPa", "TCB"], "TH7", 1, 20_000],
  [["MSBb", "TCB", "SHB"], "TH8", 2, 0],
  [["MSBb", "LPB", "BIDV"], null, 0, 0],
];

section("Quà theo bank đặc biệt, có TPB hoặc MSBb");
for (const [codes, code, years, cash] of GIFT_MATRIX) {
  const r = gift(accountsOf(codes));
  const name = codes.join(" + ");
  check(`${name}: ${code ?? "không đủ bậc"}`, r.caseCode, code);
  check(`${name}: ${years} năm BH`, r.insuranceYears, years);
  check(`${name}: tiền ${cash}`, r.cashTotal, cash);
}

section("Quà so với ngày 14/10");
check("TPB + VPa ngày 14/10 vẫn TH2", gift(accountsOf(["TPB", "VPa"], BEFORE), BEFORE).caseCode, "TH2");
check("TPB + VPa ngày 14/10 điểm 0,5", gift(accountsOf(["TPB", "VPa"], BEFORE), BEFORE).comboPoints, 0.5);
check("TPB + VPa ngày 15/10 điểm 0,7", gift(accountsOf(["TPB", "VPa"])).comboPoints, 0.7);
check("MSBb ngày 14/10 là TH1", gift(accountsOf(["MSBb"], BEFORE), BEFORE).caseCode, "TH1");
check("MSBb ngày 15/10 không đủ bậc", gift(accountsOf(["MSBb"])).caseCode, null);
check("MSBb + LPB ngày 14/10 là TH1 của Combo 1", gift(accountsOf(["MSBb", "LPB"], BEFORE), BEFORE).caseCode, "TH1");
check("MSBb + LPB ngày 15/10 không đủ bậc", gift(accountsOf(["MSBb", "LPB"])).caseCode, null);
check(
  "MSBb một mình: lời giải thích nói chưa vào được tổ hợp",
  gift(accountsOf(["MSBb"])).explain.some((e) => e.includes("chưa có tài khoản nào vào được tổ hợp")),
  true,
);

/* ── Cặp VPa + MB vẫn không thành tổ hợp ────────────────────────────── */

section("VPa + MB giữ luật kỳ trước");
check("VPa + MB = 0", comboPointsFor(["VPa", "MB"]), 0);
check("VPa + MB không có bậc", gift(accountsOf(["VPa", "MB"])).caseCode, null);
check("VPa + MB + TPB = 1,2", comboPointsFor(["VPa", "MB", "TPB"]), 1.2);
check("VPa + MB + TPB là TH7", gift(accountsOf(["VPa", "MB", "TPB"])).caseCode, "TH7");
check("VPa + MB + MSBb = 0,9", comboPointsFor(["VPa", "MB", "MSBb"]), 0.9);
check("VPa + VPb vẫn là dữ liệu sai", comboPointsFor(["VPa", "VPb"]), 0);
check("VPa + VPb + TPB vẫn 0", points(accountsOf(["VPa", "VPb", "TPB"])), 0);

/* ── CNKD, HKD với hạng mới ─────────────────────────────────────────── */

section("CNKD, HKD kèm TPB hoặc MSBb");
check("TPB CNKD = 0,3 + 1,0", points([account("k", "TPB", { household: "CNKD" })]), 1.3);
check("MSBb CNKD = 0 + 1,0", points([account("k", "MSBb", { household: "CNKD" })]), 1);
check("MSBb HKD một mình = 3,0", points([account("k", "MSBb", { household: "HKD" })]), 3);
check("TPB thường + TPB HKD = 0,3 + 3,0", points([account("k", "TPB"), account("k", "TPB", { household: "HKD" })]), 3.3);
check(
  "MSBb thường + MSBb HKD = 0 + 3,0",
  points([account("k", "MSBb"), account("k", "MSBb", { household: "HKD" })]),
  3,
);
check(
  "dòng HKD không vào combo: TPB thường + MB HKD là Combo 1 của TPB",
  points([account("k", "TPB"), account("k", "MB", { household: "HKD" })]),
  3.3,
);
check(
  "MSBb HKD vẫn có quà thêm",
  gift([account("k", "MSBb", { household: "HKD" })]).extraBasket.length,
  2,
);
check(
  "MSBb HKD: suất ở MSBb",
  (gift([account("k", "MSBb", { household: "HKD" })]).extraBanks ?? []).join(","),
  "MSBb",
);
check("dòng HKD cách ghi cũ kèm MSBb = 0 + 3,0", points([account("k", "MSBb"), account("k", "HKD")]), 3);

/* ── Chặn lúc mở: MSBb chịu trần hai bank hạn chế ───────────────────── */

section("openBlockReasonAt");
const blocked = (existing: string[], candidate: string, at = AT) =>
  openBlockReasonAt(existing, candidate, at) !== null;
check("đã có LPB + BIDV, mở MSBb: chặn", blocked(["LPB", "BIDV"], "MSBb"), true);
check("đã có LPB + BIDV, mở MSBb ngày 14/10: không chặn", blocked(["LPB", "BIDV"], "MSBb", BEFORE), false);
check("đã có MSBb + LPB, mở VIB: chặn", blocked(["MSBb", "LPB"], "VIB"), true);
check("đã có MSBb + LPB, mở VIB ngày 14/10: không chặn", blocked(["MSBb", "LPB"], "VIB", BEFORE), false);
check("đã có MSBb, mở LPB: mở được", blocked(["MSBb"], "LPB"), false);
check("đã có LPB + BIDV, mở TPB: mở được", blocked(["LPB", "BIDV"], "TPB"), false);
check("đã có LPB + BIDV, mở TCB: mở được", blocked(["LPB", "BIDV"], "TCB"), false);
check(
  "câu chặn nêu hai mã đang có",
  openBlockReasonAt(["MSBb", "LPB"], "VIB", AT)?.includes("MSBb và LPB"),
  true,
);

/* ── Thưởng combo của nhân viên điểm ATM ────────────────────────────── */

section("multiBankComboCountFor");
check("TPB + BIDV là Combo 2, đếm 1", multiBankComboCountFor(accountsOf(["TPB", "BIDV"]), "2026-10"), 1);
check(
  "TPB + BIDV ngày 14/10 là Combo 1, đếm 0",
  multiBankComboCountFor(accountsOf(["TPB", "BIDV"], BEFORE), "2026-10"),
  0,
);
check("MSBb + TCB là Combo 1, đếm 0", multiBankComboCountFor(accountsOf(["MSBb", "TCB"]), "2026-10"), 0);
check(
  "MSBb + TCB ngày 14/10 là Combo 2, đếm 1",
  multiBankComboCountFor(accountsOf(["MSBb", "TCB"], BEFORE), "2026-10"),
  1,
);
check("MSBb + LPB không đếm", multiBankComboCountFor(accountsOf(["MSBb", "LPB"]), "2026-10"), 0);
check("TPB + MSBb + LPB là Combo 3, đếm 1", multiBankComboCountFor(accountsOf(["TPB", "MSBb", "LPB"]), "2026-10"), 1);

/* ── Combo 2 có tài khoản lỗi về 0, với hạng mới ────────────────────── */

section("Combo 2 có tài khoản lỗi");
const broken = (done: ScoringAccount[], brokenRows: ScoringAccount[]) =>
  bankingPointsFor(done, "2026-10", new Map(), brokenRows);
check("TPB + BIDV, BIDV lỗi: combo 0", broken(accountsOf(["TPB"]), accountsOf(["BIDV"])), 0);
check("TPB + BIDV, TPB lỗi: 0", broken(accountsOf(["BIDV"]), accountsOf(["TPB"])), 0);
check(
  "TPB + BIDV ngày 14/10, BIDV lỗi: Combo 1 của TPB còn 0,2",
  bankingPointsFor(accountsOf(["TPB"], BEFORE), "2026-10", new Map(), accountsOf(["BIDV"], BEFORE)),
  0.2,
);
check("MSBb + MB, MSBb lỗi: combo 0", broken(accountsOf(["MB"]), accountsOf(["MSBb"])), 0);
check("MSBb + TCB, MSBb lỗi: TCB vẫn Combo 1 vì tổ hợp thắng là Combo 1", broken(accountsOf(["TCB"]), accountsOf(["MSBb"])), 0.2);
check("TPB + MB + TCB, TCB lỗi: hạ về Combo 2 = 0,7", broken(accountsOf(["TPB", "MB"]), accountsOf(["TCB"])), 0.7);
check(
  "TPB CNKD + BIDV, BIDV lỗi: giữ 1,0 của CNKD",
  broken([account("k", "TPB", { household: "CNKD" })], accountsOf(["BIDV"])),
  1,
);

/* ── Phòng Y ────────────────────────────────────────────────────────── */

section("Phòng Y chỉ quy đổi ở TH8");
const hasMi = (r: GiftResult) => r.basket.some((b) => b.code === "QUA-MI");
check("TPB + MB + TCB (TH8) có Mì", hasMi(gift(accountsOf(["TPB", "MB", "TCB"]), AT, "PHONG-Y")), true);
check("TPB + MSBb + LPB (TH8) có Mì", hasMi(gift(accountsOf(["TPB", "MSBb", "LPB"]), AT, "PHONG-Y")), true);
check("TPB + MB + VPa (TH7) không có Mì", hasMi(gift(accountsOf(["TPB", "MB", "VPa"]), AT, "PHONG-Y")), false);
check("MSBb + LPB không có Mì", hasMi(gift(accountsOf(["MSBb", "LPB"]), AT, "PHONG-Y")), false);

/* ── Tổng kết ────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} ca đạt`);
if (failures.length > 0) {
  console.log(`  ${failures.length} ca không đạt:`);
  for (const f of failures) console.log(`    ${f}`);
  process.exit(1);
}
