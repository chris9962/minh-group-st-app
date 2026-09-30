/**
 * Ca thử cho kỳ luật **2026-10-01**, chạy cùng `bun run test:rules`.
 *
 * Chỉ thử những gì KHÁC kỳ 2026-09-28 (`mgst-the-le/2026-10-01.md` mục 5, 6).
 * Phần không đổi đã có ca ở `test-rules-2026-09-28.ts` và các file trước.
 */
import {
  bankTierFor,
  bankingPointsFor,
  comboRowsAt,
  giftFor,
  householdPointsAt,
  openBlockReasonAt,
  openNotesAt,
  type GiftResult,
  type HouseholdKind,
  type ScoringAccount,
} from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-10-01";

const AT = "2026-10-01";
const BEFORE = "2026-09-30";

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

const points = (accounts: ScoringAccount[], yearMonth = "2026-10"): number =>
  bankingPointsFor(accounts, yearMonth, new Map());

const gift = (accounts: ScoringAccount[], at = AT, departmentCode: string | null = null): GiftResult =>
  giftFor({ accounts, channelCodes: [], departmentCode, grantedItem: null }, at)!;

/* ── Mục 1, 2 · hạng bank và điểm ───────────────────────────────────── */

section("VPb sang Bank khác, VIB sang Bank hạn chế");
check("VPb một mình = 0,2", comboPointsFor(["VPb"]), 0.2);
check("MB + VPb = 0,5", comboPointsFor(["MB", "VPb"]), 0.5);
check("MB + VPb + TPB = 0,8", comboPointsFor(["MB", "VPb", "TPB"]), 0.8);
check("VIB một mình = 0", comboPointsFor(["VIB"]), 0);
check("MB + VIB = 0,3", comboPointsFor(["MB", "VIB"]), 0.3);
check("TPB + VIB: về Combo 1 của TPB", comboPointsFor(["TPB", "VIB"]), 0.2);
check("VPa + VPb vẫn là dữ liệu sai", comboPointsFor(["VPa", "VPb"]), 0);

section("MSBa vào Combo 1 và Combo 2");
check("MSBa một mình = 0,3", comboPointsFor(["MSBa"]), 0.3);
check("MSBa + VPa = 0,7", comboPointsFor(["MSBa", "VPa"]), 0.7);
check("MSBa + TPB = 0,5", comboPointsFor(["MSBa", "TPB"]), 0.5);
check("MSBa + LPB = 0,3", comboPointsFor(["MSBa", "LPB"]), 0.3);

section("Bank hạn chế");
check("LPB một mình = 0", comboPointsFor(["LPB"]), 0);
check("TPB + LPB: về Combo 1 của TPB", comboPointsFor(["TPB", "LPB"]), 0.2);
check("LPB + BIDV: hai hạn chế chưa có bank thứ ba", comboPointsFor(["LPB", "BIDV"]), 0);
check("MB + LPB + BIDV = 0,5", comboPointsFor(["MB", "LPB", "BIDV"]), 0.5);
check("TPB + LPB + BIDV = 0,4", comboPointsFor(["TPB", "LPB", "BIDV"]), 0.4);
check("LPB + BIDV + VIB: ba hạn chế", comboPointsFor(["LPB", "BIDV", "VIB"]), 0);

section("VPb kèm CNKD hết dòng 0,1");
check("VPb + CNKD = 0,2 + 1,0", points([account("k", "VPb", { household: "CNKD" })]), 1.2);

/* ── Đủ 19 tổ hợp hạng · điểm theo bảng mục 2 ───────────────────────── */

/** P = MB, O = TPB/SHB/MSBb, R = LPB/BIDV/MBV. Dòng không có trong bảng ra 0. */
const TIER_POINTS: [string[], number][] = [
  [["MB"], 0.3],
  [["TPB"], 0.2],
  [["LPB"], 0],
  [["MB", "VPa"], 0.7],
  [["MB", "TPB"], 0.5],
  [["MB", "LPB"], 0.3],
  [["TPB", "SHB"], 0.4],
  [["TPB", "LPB"], 0.2],
  [["LPB", "BIDV"], 0],
  [["MB", "VPa", "MSBa"], 1.2],
  [["MB", "VPa", "TPB"], 1.0],
  [["MB", "VPa", "LPB"], 0.9],
  [["MB", "TPB", "SHB"], 0.8],
  [["MB", "TPB", "LPB"], 0.7],
  [["MB", "LPB", "BIDV"], 0.5],
  [["TPB", "SHB", "MSBb"], 0.7],
  [["TPB", "SHB", "LPB"], 0.5],
  [["TPB", "LPB", "BIDV"], 0.4],
  [["LPB", "BIDV", "MBV"], 0],
];

section("19 tổ hợp hạng, bank đại diện");
for (const [codes, expected] of TIER_POINTS) check(codes.join(" + "), comboPointsFor(codes), expected);

/** Đổi đại diện: VPb thay TPB (bank khác), VIB thay LPB (hạn chế), VPa và MSBa đổi chỗ. */
const SWAP: Record<string, string> = { TPB: "VPb", LPB: "VIB", VPa: "MSBa", MSBa: "VPa" };
section("19 tổ hợp hạng, đại diện đổi sang VPb và VIB");
for (const [codes, expected] of TIER_POINTS) {
  const swapped = codes.map((c) => SWAP[c] ?? c);
  check(swapped.join(" + "), comboPointsFor(swapped), expected);
}

/* ── Quà theo bank đặc biệt trong từng cỡ tổ hợp ────────────────────── */

/** [tài khoản, mã TH, số năm BH, tiền]. Bank đi kèm lấy đủ ba hạng. */
const GIFT_MATRIX: [string[], string, 0 | 1 | 2, number][] = [
  [["VPa"], "TH2", 0, 20_000],
  [["MSBa"], "TH3", 0, 50_000],
  [["MB"], "TH1", 1, 0],
  [["TPB"], "TH1", 1, 0],
  [["VPb"], "TH1", 1, 0],
  [["VPa", "MSBa"], "TH4", 0, 70_000],
  [["VPa", "MB"], "TH2", 0, 20_000],
  [["VPa", "TPB"], "TH2", 0, 20_000],
  [["VPa", "LPB"], "TH2", 0, 20_000],
  [["MSBa", "MB"], "TH3", 0, 50_000],
  [["MSBa", "TPB"], "TH3", 0, 50_000],
  [["MSBa", "LPB"], "TH3", 0, 50_000],
  [["MB", "TPB"], "TH1", 1, 0],
  [["MB", "LPB"], "TH1", 1, 0],
  [["TPB", "SHB"], "TH1", 1, 0],
  [["TPB", "LPB"], "TH1", 1, 0],
  [["VPa", "MSBa", "MB"], "TH5", 1, 70_000],
  [["VPa", "MSBa", "TPB"], "TH5", 1, 70_000],
  [["VPa", "MSBa", "LPB"], "TH5", 1, 70_000],
  [["MSBa", "MB", "TPB"], "TH6", 1, 50_000],
  [["MSBa", "MB", "LPB"], "TH6", 1, 50_000],
  [["MSBa", "TPB", "SHB"], "TH6", 1, 50_000],
  [["MSBa", "TPB", "LPB"], "TH6", 1, 50_000],
  [["MSBa", "LPB", "BIDV"], "TH6", 1, 50_000],
  [["VPa", "MB", "TPB"], "TH7", 1, 20_000],
  [["VPa", "MB", "LPB"], "TH7", 1, 20_000],
  [["VPa", "TPB", "SHB"], "TH7", 1, 20_000],
  [["VPa", "TPB", "LPB"], "TH7", 1, 20_000],
  [["VPa", "LPB", "BIDV"], "TH7", 1, 20_000],
  [["MB", "TPB", "SHB"], "TH8", 2, 0],
  [["MB", "TPB", "LPB"], "TH8", 2, 0],
  [["MB", "LPB", "BIDV"], "TH8", 2, 0],
  [["TPB", "SHB", "MSBb"], "TH8", 2, 0],
  [["TPB", "SHB", "LPB"], "TH8", 2, 0],
  [["TPB", "LPB", "BIDV"], "TH8", 2, 0],
];

section("Quà theo bank đặc biệt, đủ ba cỡ tổ hợp");
for (const [codes, code, years, cash] of GIFT_MATRIX) {
  const r = gift(accountsOf(codes));
  const name = codes.join(" + ");
  check(`${name}: ${code}`, r.caseCode, code);
  check(`${name}: ${years} năm BH`, r.insuranceYears, years);
  check(`${name}: tiền ${cash}`, r.cashTotal, cash);
}

/* ── Mục 4b · HKD mỗi tài khoản 3,0, cộng dồn với CNKD ──────────────── */

section("HKD");
check(
  "VPa thường + VPa HKD = 0,3 + 3,0",
  points([account("k", "VPa"), account("k", "VPa", { household: "HKD" })]),
  3.3,
);
check(
  "VPa HKD + MB HKD, không dòng chính = 6,0",
  points([account("k", "VPa", { household: "HKD" }), account("k", "MB", { household: "HKD" })]),
  6,
);
check(
  "MB thường + VPa HKD + MB HKD = 0,3 + 6,0",
  points([
    account("k", "MB"),
    account("k", "VPa", { household: "HKD" }),
    account("k", "MB", { household: "HKD" }),
  ]),
  6.3,
);
check(
  "CNKD ở MB + HKD ở VPa cộng dồn = 0,3 + 1,0 + 3,0",
  points([account("k", "MB", { household: "CNKD" }), account("k", "VPa", { household: "HKD" })]),
  4.3,
);
check(
  "dòng HKD cách ghi cũ kèm TPB = 0,2 + 3,0",
  points([account("k", "TPB"), account("k", "HKD")]),
  3.2,
);
check(
  "VPa + VPb + HKD vẫn 0",
  points([account("k", "VPa"), account("k", "VPb"), account("k", "VPa", { household: "HKD" })]),
  0,
);
check(
  "dòng HKD không vào combo: MB thường + VPa HKD là Combo 1 của MB, không phải Combo 2",
  points([account("k", "MB"), account("k", "VPa", { household: "HKD" })]),
  3.3,
);

section("Quà thêm theo số tài khoản HKD");
const twoHkd = gift([account("k", "VPa", { household: "HKD" }), account("k", "MB", { household: "HKD" })]);
check("rổ quà thêm có Loa và Bảng mica", twoHkd.extraBasket.length, 2);
check("lời giải thích nêu 2 tài khoản HKD", twoHkd.explain.some((e) => e.includes("2 tài khoản HKD")), true);
check("extraBanks nêu VPa và MB", [...(twoHkd.extraBanks ?? [])].sort().join(","), "MB,VPa");
check(
  "kỳ 30/9 extraBanks là VPa, một suất",
  (gift([account("k", "VPa", { household: "HKD", date: BEFORE })], BEFORE).extraBanks ?? []).join(","),
  "VPa",
);
check("không HKD thì extraBanks rỗng", (gift(accountsOf(["MB"])).extraBanks ?? []).length, 0);
check(
  "một HKD nêu 1 tài khoản",
  gift([account("k", "TPB"), account("k", "TPB", { household: "HKD" })]).explain.some((e) =>
    e.includes("1 tài khoản HKD"),
  ),
  true,
);

/* ── Mục 3 · quà đọc bằng loại trừ ──────────────────────────────────── */

section("Combo 1");
check("VPa là TH2", gift(accountsOf(["VPa"])).caseCode, "TH2");
check("VPa: 20k, không BH", gift(accountsOf(["VPa"])).insuranceYears, 0);
check("VPa: 20k", gift(accountsOf(["VPa"])).cashTotal, 20_000);
check("MSBa là TH3", gift(accountsOf(["MSBa"])).caseCode, "TH3");
check("MSBa: 50k, không BH", gift(accountsOf(["MSBa"])).insuranceYears, 0);
check("MSBa: 50k", gift(accountsOf(["MSBa"])).cashTotal, 50_000);
check("MB là TH1", gift(accountsOf(["MB"])).caseCode, "TH1");
check("MB: 01 năm BH", gift(accountsOf(["MB"])).insuranceYears, 1);
check("VPb là TH1", gift(accountsOf(["VPb"])).caseCode, "TH1");
check("LPB không có bậc", gift(accountsOf(["LPB"])).caseCode, null);
check("VIB không có bậc", gift(accountsOf(["VIB"])).caseCode, null);

section("Combo 2");
check("VPa + MSBa là TH4", gift(accountsOf(["VPa", "MSBa"])).caseCode, "TH4");
check("VPa + MSBa: 70k", gift(accountsOf(["VPa", "MSBa"])).cashTotal, 70_000);
check("VPa + MSBa: không BH", gift(accountsOf(["VPa", "MSBa"])).insuranceYears, 0);
check("VPa + TPB là TH2", gift(accountsOf(["VPa", "TPB"])).caseCode, "TH2");
check("VPa + TPB: không BH, chỉ 20k", gift(accountsOf(["VPa", "TPB"])).insuranceYears, 0);
check("VPa + LPB là TH2", gift(accountsOf(["VPa", "LPB"])).caseCode, "TH2");
// Hai tổ hợp bằng điểm 0,3 thì tổ hợp nhiều ngân hàng hơn thắng, không theo thứ tự nhập.
check(
  "VPa + LPB là Combo 2, không phải Combo 1 của VPa",
  gift(accountsOf(["VPa", "LPB"])).explain[0]?.includes("Tổ hợp 2 ngân hàng"),
  true,
);
check(
  "LPB + VPa theo thứ tự ngược vẫn là Combo 2",
  gift(accountsOf(["LPB", "VPa"])).explain[0]?.includes("Tổ hợp 2 ngân hàng"),
  true,
);
check("MSBa + LPB là TH3", gift(accountsOf(["MSBa", "LPB"])).caseCode, "TH3");
check("MB + TPB là TH1", gift(accountsOf(["MB", "TPB"])).caseCode, "TH1");
check("MB + TPB: 01 năm BH", gift(accountsOf(["MB", "TPB"])).insuranceYears, 1);
check("TPB + LPB là TH1 của Combo 1", gift(accountsOf(["TPB", "LPB"])).caseCode, "TH1");
check("LPB + BIDV không có bậc", gift(accountsOf(["LPB", "BIDV"])).caseCode, null);
check("MB + VPb có ghi chú 20k của VPb", gift(accountsOf(["MB", "VPb"])).giftNote !== undefined, true);

section("Combo 3");
check("MB + VPa + MSBa là TH5", gift(accountsOf(["MB", "VPa", "MSBa"])).caseCode, "TH5");
check("TH5: 01 năm BH", gift(accountsOf(["MB", "VPa", "MSBa"])).insuranceYears, 1);
check("TH5: 70k", gift(accountsOf(["MB", "VPa", "MSBa"])).cashTotal, 70_000);
check("MB + MSBa + TPB là TH6", gift(accountsOf(["MB", "MSBa", "TPB"])).caseCode, "TH6");
check("TH6: 01 năm BH + 50k", gift(accountsOf(["MB", "MSBa", "TPB"])).cashTotal, 50_000);
check("MB + TPB + VPa là TH7", gift(accountsOf(["MB", "TPB", "VPa"])).caseCode, "TH7");
check("TH7: 01 năm BH, không còn 02 năm", gift(accountsOf(["MB", "TPB", "VPa"])).insuranceYears, 1);
check("TH7: 20k", gift(accountsOf(["MB", "TPB", "VPa"])).cashTotal, 20_000);
check("MB + TPB + SHB là TH8", gift(accountsOf(["MB", "TPB", "SHB"])).caseCode, "TH8");
check("TH8: 02 năm BH", gift(accountsOf(["MB", "TPB", "SHB"])).insuranceYears, 2);
check("MB + LPB + BIDV là TH8", gift(accountsOf(["MB", "LPB", "BIDV"])).caseCode, "TH8");
check("TPB + LPB + BIDV là TH8", gift(accountsOf(["TPB", "LPB", "BIDV"])).caseCode, "TH8");

section("Không xét cài app");
check("VPa chưa cài app vẫn TH2", gift([account("k", "VPa", { app: false })]).caseCode, "TH2");
check("MSBa chưa cài app vẫn TH3", gift([account("k", "MSBa", { app: false })]).caseCode, "TH3");
check(
  "VPa chưa cài + MSBa chưa cài vẫn TH4",
  gift([account("k", "VPa", { app: false }), account("k", "MSBa", { app: false })]).caseCode,
  "TH4",
);

section("Bỏ hạn chi tiền");
check("tiền không có hạn chi", gift(accountsOf(["VPa"])).cash[0]?.withinDays, undefined);
check(
  "lời giải thích không nêu số ngày",
  gift(accountsOf(["VPa", "MSBa"])).explain.some((e) => e.includes("chi trong")),
  false,
);

section("Phòng Y chỉ quy đổi ở TH8");
const hasMi = (r: GiftResult) => r.basket.some((b) => b.code === "QUA-MI");
check("TH8 có Mì", hasMi(gift(accountsOf(["MB", "TPB", "SHB"]), AT, "PHONG-Y")), true);
check("TH7 không có Mì", hasMi(gift(accountsOf(["MB", "TPB", "VPa"]), AT, "PHONG-Y")), false);
check("TH6 không có Mì", hasMi(gift(accountsOf(["MB", "MSBa", "TPB"]), AT, "PHONG-Y")), false);

/* ── Mục 5b · chọn luật theo ngày hồ sơ ─────────────────────────────── */

section("Kỳ nào áp luật nào");
check("VPa + TPB ngày 30/9 vẫn TH1 cũ", gift(accountsOf(["VPa", "TPB"], BEFORE), BEFORE).caseCode, "TH1");
check("VPa + TPB ngày 30/9 có 01 năm BH", gift(accountsOf(["VPa", "TPB"], BEFORE), BEFORE).insuranceYears, 1);
check("VPa + TPB ngày 1/10 là TH2", gift(accountsOf(["VPa", "TPB"])).caseCode, "TH2");
check("MSBa một mình ngày 30/9 = 0", points(accountsOf(["MSBa"], BEFORE), "2026-09"), 0);
check("MSBa một mình ngày 1/10 = 0,3", points(accountsOf(["MSBa"])), 0.3);
check(
  "hai HKD ngày 30/9 vẫn 3,0",
  points(
    [
      account("k", "VPa", { household: "HKD", date: BEFORE }),
      account("k", "MB", { household: "HKD", date: BEFORE }),
    ],
    "2026-09",
  ),
  3,
);

/* ── Chặn lúc mở ────────────────────────────────────────────────────── */

section("openBlockReasonAt — VIB là hạn chế");
const blocked = (existing: string[], candidate: string, at = AT) =>
  openBlockReasonAt(existing, candidate, at) !== null;
check("đã có LPB, mở VIB", blocked(["LPB"], "VIB"), false);
check("đã có LPB + BIDV, mở VIB", blocked(["LPB", "BIDV"], "VIB"), true);
check("đã có LPB + BIDV, mở VPb: VPb là bank khác", blocked(["LPB", "BIDV"], "VPb"), false);
check("ngày 30/9 VIB còn là bank khác", blocked(["LPB", "BIDV"], "VIB", BEFORE), false);

section("openNotesAt, comboRowsAt, bankTierFor");
check("ghi chú nêu HKD mọi ngân hàng", openNotesAt(AT).some((n) => n.includes("Mỗi tài khoản HKD")), true);
check("kỳ 1/10 tự khai bảng tổ hợp", comboRowsAt(AT) !== null, true);
check("VPb là bank khác", bankTierFor("VPb", AT), "other");
check("VIB là bank hạn chế", bankTierFor("VIB", AT), "restricted");
check("VPb ngày 30/9 còn là hạn chế", bankTierFor("VPb", BEFORE), "restricted");
check("VIB ngày 30/9 còn là bank khác", bankTierFor("VIB", BEFORE), "other");

/* ── Ca biên ────────────────────────────────────────────────────────── */

section("CNKD, HKD ca biên");
check(
  "CNKD ở 2 ngân hàng vẫn 1,0 mỗi hồ sơ (G17)",
  points([account("k", "MB", { household: "CNKD" }), account("k", "TPB", { household: "CNKD" })]),
  1.5,
);
check("HKD ở ngân hàng ngoài thể lệ = 0", points([account("k", "XYZ", { household: "HKD" })]), 0);
check(
  "HKD ngoài thể lệ kèm TPB chỉ có 0,2",
  points([account("k", "TPB"), account("k", "XYZ", { household: "HKD" })]),
  0.2,
);
check(
  "hai dòng HKD cùng một ngân hàng đếm một",
  points([account("k", "VPa", { household: "HKD" }), account("k", "VPa", { household: "HKD" })]),
  3,
);
check(
  "householdPointsAt: 2 HKD + CNKD = 7,0",
  householdPointsAt(
    [
      account("k", "VPa", { household: "HKD" }),
      account("k", "MB", { household: "HKD" }),
      account("k", "TPB", { household: "CNKD" }),
    ],
    AT,
  ),
  7,
);

section("Rổ quà khi tiền thay bảo hiểm");
check("VPa một mình: rổ chính rỗng", gift(accountsOf(["VPa"])).basket.length, 0);
check("VPa một mình, Phòng Y: rổ chính vẫn rỗng", gift(accountsOf(["VPa"]), AT, "PHONG-Y").basket.length, 0);
check("MB + LPB là TH1", gift(accountsOf(["MB", "LPB"])).caseCode, "TH1");
check("MB + LPB: 01 năm BH", gift(accountsOf(["MB", "LPB"])).insuranceYears, 1);

section("VPa + VPb: điểm 0, quà vẫn tính (việc treo từ kỳ 28/9)");
check("điểm 0", points(accountsOf(["VPa", "VPb"])), 0);
check("quà ra TH2 như VPa một mình", gift(accountsOf(["VPa", "VPb"])).caseCode, "TH2");

/* ── Tổng kết ────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} ca đạt`);
if (failures.length > 0) {
  console.log(`  ${failures.length} ca không đạt:`);
  for (const f of failures) console.log(`    ${f}`);
  process.exit(1);
}
