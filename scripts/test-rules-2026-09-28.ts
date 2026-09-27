/**
 * Ca thử cho kỳ luật **2026-09-28** — chạy cùng `bun run test:rules`.
 *
 * Chỉ thử những gì KHÁC kỳ 2026-09-16 (`mgst-the-le/2026-09-28.md` mục 5, 6).
 * Phần không đổi đã có ca ở `test-rules-2026-09-16.ts`.
 */
import {
  bankingPointsFor,
  comboRowsAt,
  giftFor,
  openBlockReasonAt,
  type GiftResult,
  type HouseholdKind,
  type ScoringAccount,
} from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-09-28";

const AT = "2026-09-28";
const BEFORE = "2026-09-27";

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
  opts: { app?: boolean; date?: string; household?: HouseholdKind } = {},
): ScoringAccount => ({
  customerId,
  bankCode,
  appInstalled: opts.app ?? true,
  openedDate: opts.date ?? AT,
  household: opts.household ?? "none",
});

const accountsOf = (codes: string[], date = AT) => codes.map((code) => account("k", code, { date }));

const points = (accounts: ScoringAccount[], yearMonth = "2026-09"): number =>
  bankingPointsFor(accounts, yearMonth, new Map());

const gift = (accounts: ScoringAccount[], at = AT): GiftResult =>
  giftFor({ accounts, channelCodes: [], departmentCode: null, grantedItem: null }, at)!;

/* ── Mục 2 · ba dòng mới ────────────────────────────────────────────── */

section("Combo 2 — 01 ưu tiên + 01 hạn chế = 0,3");
check("MB + LPB", comboPointsFor(["MB", "LPB"]), 0.3);
check("VPa + BIDV", comboPointsFor(["VPa", "BIDV"]), 0.3);
check("MB + VPb", comboPointsFor(["MB", "VPb"]), 0.3);
check("MSBa + LPB: MSBa vẫn ngoài Combo 2 (G14)", comboPointsFor(["MSBa", "LPB"]), 0);
check("TPB + LPB: khác + hạn chế không có dòng, về Combo 1 của TPB", comboPointsFor(["TPB", "LPB"]), 0.2);
check("LPB + MBV: hai hạn chế không có dòng", comboPointsFor(["LPB", "MBV"]), 0);
check("VPa + VPb vẫn là dữ liệu sai", comboPointsFor(["VPa", "VPb"]), 0);

section("Combo 3 — hai hạn chế");
check("MB + LPB + BIDV = 0,5", comboPointsFor(["MB", "LPB", "BIDV"]), 0.5);
check("VPa + LPB + MBV = 0,5", comboPointsFor(["VPa", "LPB", "MBV"]), 0.5);
check("MSBa + LPB + BIDV = 0,5", comboPointsFor(["MSBa", "LPB", "BIDV"]), 0.5);
check("TPB + LPB + BIDV = 0,4", comboPointsFor(["TPB", "LPB", "BIDV"]), 0.4);
check("MB + LPB + VPb = 0,5", comboPointsFor(["MB", "LPB", "VPb"]), 0.5);
check("VPa + VPb + LPB vẫn là dữ liệu sai", comboPointsFor(["VPa", "VPb", "LPB"]), 0);
check("LPB + BIDV + MBV: ba hạn chế không có dòng", comboPointsFor(["LPB", "BIDV", "MBV"]), 0);

section("Dòng cũ giữ nguyên");
check("MB + VPa + LPB", comboPointsFor(["MB", "VPa", "LPB"]), 0.9);
check("MB + TPB + LPB", comboPointsFor(["MB", "TPB", "LPB"]), 0.7);
check("TPB + MSBb + LPB", comboPointsFor(["TPB", "MSBb", "LPB"]), 0.5);
check("MB + TPB", comboPointsFor(["MB", "TPB"]), 0.5);
check("LPB một mình", comboPointsFor(["LPB"]), 0);
check("VPb + CNKD vẫn 1,1", points([account("k", "VPb", { household: "CNKD" })]), 1.1);

/* ── Mục 3 · quà ────────────────────────────────────────────────────── */

section("Quà của ba dòng mới");
check("VPa + LPB là TH1", gift(accountsOf(["VPa", "LPB"])).caseCode, "TH1");
check("VPa + LPB theo thứ tự ngược vẫn TH1", gift(accountsOf(["LPB", "VPa"])).caseCode, "TH1");
check("VPa + LPB có 1 năm BH", gift(accountsOf(["VPa", "LPB"])).insuranceYears, 1);
check("VPa + LPB có 20k", gift(accountsOf(["VPa", "LPB"])).cashTotal, 20_000);
check("MB + LPB là TH2", gift(accountsOf(["MB", "LPB"])).caseCode, "TH2");
check("LPB + MB theo thứ tự ngược vẫn TH2", gift(accountsOf(["LPB", "MB"])).caseCode, "TH2");
check("VPa chưa cài app + LPB là TH2", gift([account("k", "VPa", { app: false }), account("k", "LPB")]).caseCode, "TH2");
check("MSBa + LPB không có bậc", gift(accountsOf(["MSBa", "LPB"])).caseCode, null);
check("TPB + LPB vẫn TH7", gift(accountsOf(["TPB", "LPB"])).caseCode, "TH7");
check("MB + VPb có ghi chú 20k của VPb", gift(accountsOf(["MB", "VPb"])).giftNote !== undefined, true);

check("MB + LPB + BIDV là TH6", gift(accountsOf(["MB", "LPB", "BIDV"])).caseCode, "TH6");
check("MB + LPB + BIDV có 2 năm BH", gift(accountsOf(["MB", "LPB", "BIDV"])).insuranceYears, 2);
check("TPB + LPB + BIDV là TH6", gift(accountsOf(["TPB", "LPB", "BIDV"])).caseCode, "TH6");
check("VPa + LPB + BIDV là TH5 (G13)", gift(accountsOf(["VPa", "LPB", "BIDV"])).caseCode, "TH5");
check("MSBa + LPB + BIDV là TH4 (G13)", gift(accountsOf(["MSBa", "LPB", "BIDV"])).caseCode, "TH4");

/* ── Mục 5b · chọn luật theo ngày hồ sơ ─────────────────────────────── */

section("Kỳ nào áp luật nào");
check("MB + LPB + BIDV ngày 27/9 theo file 16/9", points(accountsOf(["MB", "LPB", "BIDV"], BEFORE)), 0.3);
check("MB + LPB + BIDV ngày 28/9", points(accountsOf(["MB", "LPB", "BIDV"])), 0.5);
check("VPa + LPB ngày 27/9 vẫn TH8", gift(accountsOf(["VPa", "LPB"], BEFORE), BEFORE).caseCode, "TH8");
check(
  "hai khách hai kỳ trong cùng tháng, cộng đúng",
  points([
    account("a", "MB", { date: BEFORE }),
    account("a", "LPB", { date: BEFORE }),
    account("a", "BIDV", { date: BEFORE }),
    account("b", "MB"),
    account("b", "LPB"),
    account("b", "BIDV"),
  ]),
  0.8,
);

/* ── Chặn lúc mở: tối đa hai ngân hàng hạn chế ──────────────────────── */

section("openBlockReasonAt — tối đa hai ngân hàng hạn chế");
const blocked = (existing: string[], candidate: string, at = AT) =>
  openBlockReasonAt(existing, candidate, at) !== null;
check("đã có LPB, mở BIDV", blocked(["LPB"], "BIDV"), false);
check("đã có MB + LPB, mở VPb", blocked(["MB", "LPB"], "VPb"), false);
check("đã có LPB + BIDV, mở MBV", blocked(["LPB", "BIDV"], "MBV"), true);
check("đã có LPB + BIDV, mở MB", blocked(["LPB", "BIDV"], "MB"), false);
check("mã trùng đếm một lần", blocked(["LPB", "LPB"], "BIDV"), false);
check("ngày 27/9 vẫn chặn hạn chế thứ hai", blocked(["LPB"], "BIDV", BEFORE), true);
check(
  "câu chữ nêu hai mã đang có",
  openBlockReasonAt(["MB", "LPB", "BIDV"], "MBV", AT),
  "Hồ sơ đã có LPB và BIDV thuộc nhóm hạn chế. Mỗi hồ sơ mở tối đa hai ngân hàng hạn chế.",
);

/* ── Bảng tổ hợp của hộp thoại ──────────────────────────────────────── */

section("comboRowsAt");
check("kỳ 28/9 tự khai bảng", comboRowsAt(AT)?.some((r) => r.label === "1 ưu tiên + 2 hạn chế"), true);
check("kỳ 16/9 dùng bảng chung", comboRowsAt(BEFORE) === null, true);

/* ── Tổng kết ────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} ca đạt`);
if (failures.length > 0) {
  console.log(`  ${failures.length} ca không đạt:`);
  for (const f of failures) console.log(`    ${f}`);
  process.exit(1);
}
