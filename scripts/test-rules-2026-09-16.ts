/**
 * Ca thử cho kỳ luật **2026-09-16** — chạy cùng `bun run test:rules`.
 *
 * Chỉ thử những gì KHÁC kỳ 2026-09-01 (`mgst-the-le/2026-09-16.md` mục 5, 5b,
 * 6) và cách chọn luật theo NGÀY của `src/rules/index.ts`. Phần không đổi đã
 * có ca ở `test-rules-2026-09.ts`; file đó ghim ngày 15/9 nên vẫn chạy trên
 * file cũ.
 */
import {
  bankTierFor,
  bankingPointsFor,
  giftFor,
  ruleDateOf,
  type GiftResult,
  type HouseholdKind,
  type ScoringAccount,
} from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-09-16";

const AT = "2026-09-16";
const BEFORE = "2026-09-15";

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

const points = (accounts: ScoringAccount[], yearMonth = "2026-09"): number =>
  bankingPointsFor(accounts, yearMonth, new Map());

const gift = (accounts: ScoringAccount[], at = AT): GiftResult =>
  giftFor({ accounts, channelCodes: [], departmentCode: null, grantedItem: null }, at)!;

/* ── Mục 1 · hạng ngân hàng đổi theo NGÀY ───────────────────────────── */

section("LPB và MBV là Bank hạn chế từ 16/9");
check("LPB ngày 15/9 là Bank khác", bankTierFor("LPB", BEFORE), "other");
check("LPB ngày 16/9 là Bank hạn chế", bankTierFor("LPB", AT), "restricted");
check("MBV ngày 15/9 ngoài thể lệ", bankTierFor("MBV", BEFORE), null);
check("MBV ngày 16/9 là Bank hạn chế", bankTierFor("MBV", AT), "restricted");
check("VPb vẫn hạn chế", bankTierFor("VPb", AT), "restricted");
check("TCB vẫn Bank khác", bankTierFor("TCB", AT), "other");
check("chuỗi tháng đọc là mùng 1, ra file cũ", bankTierFor("LPB", "2026-09"), "other");
check("tháng 10 vẫn dùng file 16/9", bankTierFor("LPB", "2026-10-03"), "restricted");

/* ── Mục 2 · bảng điểm với LPB hạn chế ──────────────────────────────── */

section("Combo 3 — LPB thế chỗ VPb ở dòng hạn chế");
check("02 ưu tiên + LPB", comboPointsFor(["MB", "VPa", "LPB"]), 0.9);
check("01 ưu tiên + 01 khác + LPB", comboPointsFor(["MB", "TPB", "LPB"]), 0.7);
check("02 khác + LPB", comboPointsFor(["TPB", "MSBb", "LPB"]), 0.5);
check("02 ưu tiên + MBV", comboPointsFor(["MB", "MSBa", "MBV"]), 0.9);
check("03 khác không có LPB", comboPointsFor(["TPB", "MSBb", "TCB"]), 0.7);

section("Hai hạn chế trong ba ngân hàng — không có dòng, hạ xuống Combo 1 (G11)");
check("MB + LPB + VPb", comboPointsFor(["MB", "LPB", "VPb"]), 0.3);
check("TPB + LPB + MBV", comboPointsFor(["TPB", "LPB", "MBV"]), 0.2);
check("LPB + MBV + VPb", comboPointsFor(["LPB", "MBV", "VPb"]), 0);

section("Combo 2 — hạn chế không vào, còn lại đứng một mình");
check("MB + LPB về Combo 1 của MB", comboPointsFor(["MB", "LPB"]), 0.3);
check("TPB + LPB về Combo 1 của TPB", comboPointsFor(["TPB", "LPB"]), 0.2);
check("LPB + MBV không có gì", comboPointsFor(["LPB", "MBV"]), 0);
check("MB + TPB vẫn 0,5", comboPointsFor(["MB", "TPB"]), 0.5);

section("Combo 1 — hạn chế đứng một mình không có tổ hợp (G10)");
check("LPB", comboPointsFor(["LPB"]), 0);
check("MBV", comboPointsFor(["MBV"]), 0);
check("VPb", comboPointsFor(["VPb"]), 0);
check("MB", comboPointsFor(["MB"]), 0.3);
check("TPB", comboPointsFor(["TPB"]), 0.2);
check("MSBa vẫn ngoài Combo 1", comboPointsFor(["MSBa"]), 0);

/* ── Mục 2 dòng 0,1 · VPb kèm CNKD (G9) ─────────────────────────────── */

section("VPb kèm CNKD = 0,1 tổ hợp + 1,0 CNKD");
check("VPb + CNKD", points([account("k", "VPb", { household: "CNKD" })]), 1.1);
check("VPa + CNKD vẫn 1,3", points([account("k", "VPa", { household: "CNKD" })]), 1.3);
check(
  "VPb + LPB + CNKD: tổ hợp là VPb, không phải LPB",
  points([account("k", "VPb", { household: "CNKD" }), account("k", "LPB")]),
  1.1,
);
check(
  "VPb + LPB + TPB + CNKD: Combo 1 của TPB + CNKD",
  points([account("k", "VPb", { household: "CNKD" }), account("k", "LPB"), account("k", "TPB")]),
  1.2,
);
check("VPb + HKD vẫn không có gì", points([account("k", "VPb", { household: "HKD" })]), 0);
check("LPB + VPa + CNKD: Combo 1 của VPa + CNKD", points([account("k", "VPa", { household: "CNKD" }), account("k", "LPB")]), 1.3);

/* ── Mục 3 · quà ────────────────────────────────────────────────────── */

section("Quà theo tổ hợp mới");
check("LPB một mình không có bậc", gift([account("k", "LPB")]).caseCode, null);
check("MBV một mình không có bậc", gift([account("k", "MBV")]).caseCode, null);
check("VPb + CNKD là TH7", gift([account("k", "VPb", { household: "CNKD" })]).caseCode, "TH7");
check("MB + LPB là TH7 của MB", gift([account("k", "MB"), account("k", "LPB")]).caseCode, "TH7");
check("VPa + LPB là TH8 của VPa", gift([account("k", "VPa"), account("k", "LPB")]).caseCode, "TH8");
check("VPa + LPB có 20k", gift([account("k", "VPa"), account("k", "LPB")]).cashTotal, 20_000);
check("MB + TPB + LPB vẫn TH6", gift([account("k", "MB"), account("k", "TPB"), account("k", "LPB")]).caseCode, "TH6");
check("MB + VPa + LPB vẫn TH5", gift([account("k", "MB"), account("k", "VPa"), account("k", "LPB")]).caseCode, "TH5");
const twoRestricted = gift([account("k", "MB"), account("k", "LPB"), account("k", "VPb")]);
check("MB + LPB + VPb là TH7", twoRestricted.caseCode, "TH7");
check("VPb không trong tổ hợp thắng nên không có ghi chú 20k", twoRestricted.giftNote, undefined);
check("LPB một mình ngày 15/9 vẫn TH7 theo file cũ", gift([account("k", "LPB", { date: BEFORE })], BEFORE).caseCode, "TH7");

/* ── Mục 5b · chọn luật theo ngày mở tài khoản ──────────────────────── */

section("bankingPointsFor chọn luật theo từng khách");
check("MB + LPB mở 15/9", points([account("a", "MB", { date: BEFORE }), account("a", "LPB", { date: BEFORE })]), 0.5);
check("MB + LPB mở 16/9", points([account("a", "MB"), account("a", "LPB")]), 0.3);
check(
  "hai khách hai kỳ trong cùng tháng, cộng đúng",
  points([
    account("a", "MB", { date: BEFORE }),
    account("a", "LPB", { date: BEFORE }),
    account("b", "MB"),
    account("b", "LPB"),
  ]),
  0.8,
);
check(
  "một khách mở 15/9 và 16/9 theo luật 16/9 (G12)",
  points([account("a", "MB", { date: BEFORE }), account("a", "LPB")]),
  0.3,
);
check(
  "0,7 + 0,5 ra đúng 1,2, không có sai số nhị phân",
  points([
    account("a", "MB", { date: BEFORE }),
    account("a", "VPa", { date: BEFORE }),
    account("b", "MB"),
    account("b", "TPB"),
  ]),
  1.2,
);
check("tài khoản tháng 8 không vào tháng 9", points([account("a", "MB", { date: "2026-08-20" })]), 0);
check("tháng 10 chạy file 16/9", points([account("a", "MB", { date: "2026-10-02" }), account("a", "LPB", { date: "2026-10-02" })], "2026-10"), 0.3);

section("ruleDateOf");
check("ngày muộn nhất", ruleDateOf([account("a", "MB", { date: BEFORE }), account("a", "LPB")]), AT);
check("một tài khoản", ruleDateOf([account("a", "MB", { date: BEFORE })]), BEFORE);
check("không tài khoản", ruleDateOf([]), null);
check("tài khoản không có ngày", ruleDateOf([account("a", "MB", { date: "" })]), null);

section("giftFor với chuỗi tháng đọc là mùng 1");
check("LPB một mình, hỏi bằng tháng, ra TH7 của file cũ", gift([account("k", "LPB")], "2026-09").caseCode, "TH7");
check("LPB một mình, hỏi bằng 2026-10-01, không bậc", gift([account("k", "LPB")], "2026-10-01").caseCode, null);

/* ── Tổng kết ────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} ca đạt`);
if (failures.length > 0) {
  console.log(`  ${failures.length} ca không đạt:`);
  for (const f of failures) console.log(`    ${f}`);
  process.exit(1);
}
