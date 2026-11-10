/**
 * Ca thử cho kỳ luật **2026-11-11**, chạy cùng `bun run test:rules`.
 *
 * Chỉ thử điểm KHÁC kỳ 2026-11-01: ví ShopeePay cộng 0,5 và có suất quà thêm
 * riêng, bank hạn chế kèm ShopeePay vào Combo 1. Phần không đổi đã có ca ở
 * `test-rules-2026-11-01.ts` và các kỳ trước.
 */
import {
  bankTierFor,
  bankingPointsFor,
  comboPointsAt,
  giftFor,
  householdPointsAt,
  multiBankComboCountFor,
  openBlockReasonAt,
  openNotesAt,
  winningComboSizeAt,
  type GiftResult,
  type HouseholdKind,
  type ScoringAccount,
} from "../src/rules";

const AT = "2026-11-11";
const BEFORE = "2026-11-10";
const PHONG_Y = "PHONG-Y";
const SP = "ShopeePay";

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

const points = (accounts: ScoringAccount[], broken: ScoringAccount[] = []): number =>
  bankingPointsFor(accounts, accounts[0]?.openedDate.slice(0, 7) ?? AT.slice(0, 7), new Map(), broken);

const gift = (accounts: ScoringAccount[], at = AT, departmentCode: string | null = null): GiftResult =>
  giftFor({ accounts, channelCodes: [], departmentCode, grantedItem: null }, at)!;

const codesOf = (items: { code: string }[]) => items.map((i) => i.code).join(",");

/* ── ShopeePay không phải ngân hàng ─────────────────────────────────── */

section("ShopeePay không có hạng, không vào combo");
check("ShopeePay không có hạng", bankTierFor(SP, AT), null);
check("MB + ShopeePay là Combo 1", winningComboSizeAt(accountsOf(["MB", SP]), AT), 1);
check("MB + TPB + ShopeePay là Combo 2", winningComboSizeAt(accountsOf(["MB", "TPB", SP]), AT), 2);
check("MB + TPB + MSBa + ShopeePay là Combo 3", winningComboSizeAt(accountsOf(["MB", "TPB", "MSBa", SP]), AT), 3);
check("điểm tổ hợp MB + ShopeePay = 0,3", comboPointsAt(["MB", SP], AT), 0.3);
check("MB + ShopeePay không đếm thưởng combo", multiBankComboCountFor(accountsOf(["MB", SP]), "2026-11"), 0);
check("MB + TPB + ShopeePay đếm 1 thưởng combo", multiBankComboCountFor(accountsOf(["MB", "TPB", SP]), "2026-11"), 1);

section("ShopeePay cộng 0,5");
check("MB + ShopeePay = 0,8", points(accountsOf(["MB", SP])), 0.8);
check("SHB + ShopeePay = 0,7", points(accountsOf(["SHB", SP])), 0.7);
check("MB + TPB + ShopeePay = 1,2", points(accountsOf(["MB", "TPB", SP])), 1.2);
check("MB + TPB + MSBa + ShopeePay = 1,7", points(accountsOf(["MB", "TPB", "MSBa", SP])), 1.7);
check("phần điểm ngoài tổ hợp của MB + ShopeePay = 0,5", householdPointsAt(accountsOf(["MB", SP]), AT), 0.5);
check(
  "MB + VPa HKD + ShopeePay = 3,8",
  points([account("k", "MB"), account("k", "VPa", { household: "HKD" }), account("k", SP)]),
  3.8,
);
check(
  "MB CNKD + ShopeePay = 1,8",
  points([account("k", "MB", { household: "CNKD" }), account("k", SP)]),
  1.8,
);
check("VPa + MB + ShopeePay: tổ hợp 0, ShopeePay 0,5", points(accountsOf(["VPa", "MB", SP])), 0.5);
check("VPa + VPb + ShopeePay: hồ sơ sai, 0 điểm", points(accountsOf(["VPa", "VPb", SP])), 0);
check("TCB + ShopeePay: TCB ngoài thể lệ, 0 điểm", points(accountsOf(["TCB", SP])), 0);
check(
  "hai khách: MB + ShopeePay và TPB = 1,1",
  points([account("a", "MB"), account("a", SP), account("b", "TPB")]),
  1.1,
);

section("ShopeePay không triển khai một mình");
check("chỉ ShopeePay = 0", points(accountsOf([SP])), 0);
check("chỉ ShopeePay: không có suất quà thêm", gift(accountsOf([SP])).extraBanks?.length, 0);
check("chỉ ShopeePay: rổ quà thêm rỗng", gift(accountsOf([SP])).extraBasket.length, 0);
check(
  "ShopeePay + chỉ dòng VPa HKD: HKD 3,0, ShopeePay 0",
  points([account("k", "VPa", { household: "HKD" }), account("k", SP)]),
  3,
);
check(
  "MB + ShopeePay, MB bị đánh lỗi = 0",
  points([account("k", SP)], [account("k", "MB")]),
  0,
);
check(
  "MB + TPB + ShopeePay, TPB bị đánh lỗi: Combo 2 về 0, ShopeePay còn 0,5",
  points([account("k", "MB"), account("k", SP)], [account("k", "TPB")]),
  0.5,
);

section("Phòng Y: ShopeePay không thành Combo 2");
check("Phòng Y, MB + ShopeePay = 0,8", points(accountsOf(["MB", SP], AT, PHONG_Y)), 0.8);
check("Phòng Y, MB + TPB + ShopeePay = 1,3", points(accountsOf(["MB", "TPB", SP], AT, PHONG_Y)), 1.3);

/* ── Bank hạn chế kèm ShopeePay ─────────────────────────────────────── */

section("Bank hạn chế kèm ShopeePay vào Combo 1");
check("LPB một mình = 0", points(accountsOf(["LPB"])), 0);
check("LPB + ShopeePay = 0,6", points(accountsOf(["LPB", SP])), 0.6);
for (const code of ["BIDV", "MBV", "VIB"]) check(`${code} + ShopeePay = 0,6`, points(accountsOf([code, SP])), 0.6);
check("LPB + ShopeePay là Combo 1", winningComboSizeAt(accountsOf(["LPB", SP]), AT), 1);
check("điểm tổ hợp LPB + ShopeePay = 0,1", comboPointsAt(["LPB", SP], AT), 0.1);
check("LPB + BIDV = 0", points(accountsOf(["LPB", "BIDV"])), 0);
check("LPB + BIDV + ShopeePay = 0,6", points(accountsOf(["LPB", "BIDV", SP])), 0.6);
check("SHB + LPB + ShopeePay: Combo 1 của SHB, 0,7", points(accountsOf(["SHB", "LPB", SP])), 0.7);
check("MB + LPB + ShopeePay: Combo 2 PR, 0,8", points(accountsOf(["MB", "LPB", SP])), 0.8);
check("MB + LPB + ShopeePay vẫn là Combo 2", winningComboSizeAt(accountsOf(["MB", "LPB", SP]), AT), 2);
check("MB + LPB + BIDV + ShopeePay = 1,0", points(accountsOf(["MB", "LPB", "BIDV", SP])), 1);
check("LPB + ShopeePay: quà TH1", gift(accountsOf(["LPB", SP])).caseCode, "TH1");
check("LPB + ShopeePay: 01 năm BH", gift(accountsOf(["LPB", SP])).insuranceYears, 1);
check("LPB một mình: không quà", gift(accountsOf(["LPB"])).caseCode, null);

/* ── Quà thêm ShopeePay ─────────────────────────────────────────────── */

section("Suất quà thêm ShopeePay");
const mbSp = gift(accountsOf(["MB", SP]));
check("MB + ShopeePay: quà chính TH1", mbSp.caseCode, "TH1");
check("MB + ShopeePay: một suất quà thêm", (mbSp.extraBanks ?? []).join(","), SP);
check("MB + ShopeePay: rổ quà thêm", codesOf(mbSp.extraBasket), "QUA-SHOPEEPAY");
check("MB + ShopeePay: món của suất ShopeePay", mbSp.extraItemsOf?.[SP]?.join(","), "QUA-SHOPEEPAY");
check("VPa + ShopeePay: TH2, tiền 20k giữ nguyên", gift(accountsOf(["VPa", SP])).cashTotal, 20_000);
check("MB không ShopeePay: không có suất quà thêm", gift(accountsOf(["MB"])).extraBanks?.length, 0);

const hkdSp = gift([account("k", "MB"), account("k", "VPa", { household: "HKD" }), account("k", SP)]);
check("MB + VPa HKD + ShopeePay: hai suất", (hkdSp.extraBanks ?? []).join(","), `VPa,${SP}`);
check("suất VPa HKD chọn Loa, Bảng mica", hkdSp.extraItemsOf?.VPa?.join(","), "QUA-LOA,QUA-MICA");
check("suất ShopeePay chỉ có món ShopeePay", hkdSp.extraItemsOf?.[SP]?.join(","), "QUA-SHOPEEPAY");
check("rổ quà thêm gộp ba món", codesOf(hkdSp.extraBasket), "QUA-LOA,QUA-MICA,QUA-SHOPEEPAY");

const cnkdSp = gift([account("k", "VPa", { household: "CNKD" }), account("k", SP)]);
check("VPa CNKD + ShopeePay: suất VPa chỉ có Loa", cnkdSp.extraItemsOf?.VPa?.join(","), "QUA-LOA");
check("VPa CNKD + ShopeePay: suất ShopeePay", cnkdSp.extraItemsOf?.[SP]?.join(","), "QUA-SHOPEEPAY");

const voidSp = gift(accountsOf(["VPa", "MB", SP]));
check("VPa + MB + ShopeePay: không quà chính", voidSp.caseCode, null);
check("VPa + MB + ShopeePay: vẫn có suất ShopeePay", (voidSp.extraBanks ?? []).join(","), SP);

const bothVp = gift(accountsOf(["VPa", "VPb", SP]));
check("VPa + VPb + ShopeePay: hồ sơ sai, không có suất ShopeePay", bothVp.extraBanks?.length, 0);
check("VPa + VPb + ShopeePay: rổ quà thêm rỗng", bothVp.extraBasket.length, 0);

/* ── Chặn lúc mở và mốc ngày ────────────────────────────────────────── */

section("Chặn lúc mở");
check("hồ sơ chưa có ngân hàng: chặn ShopeePay", openBlockReasonAt([], SP, AT) !== null, true);
check("hồ sơ chỉ có TCB: chặn ShopeePay", openBlockReasonAt(["TCB"], SP, AT) !== null, true);
check("hồ sơ có MB: mở được ShopeePay", openBlockReasonAt(["MB"], SP, AT), null);
check("hồ sơ có LPB: mở được ShopeePay", openBlockReasonAt(["LPB"], SP, AT), null);
check("hồ sơ có ShopeePay: mở được MB", openBlockReasonAt([SP], "MB", AT), null);
check("vẫn chặn bank hạn chế thứ ba", openBlockReasonAt(["LPB", "BIDV", SP], "VIB", AT) !== null, true);

section("Hồ sơ ngày 10/11 theo kỳ 2026-11-01");
check("MB + ShopeePay ngày 10/11 = 0,3", points(accountsOf(["MB", SP], BEFORE)), 0.3);
check("LPB + ShopeePay ngày 10/11 = 0", points(accountsOf(["LPB", SP], BEFORE)), 0);
check("ngày 10/11 không có suất ShopeePay", gift(accountsOf(["MB", SP], BEFORE), BEFORE).extraBanks?.length, 0);
check("ngày 10/11 không chặn ShopeePay", openBlockReasonAt([], SP, BEFORE), null);
check("có câu ShopeePay", openNotesAt(AT).some((note) => note.includes("ShopeePay không mở một mình")), true);
check("ngày 10/11 chưa có câu ShopeePay", openNotesAt(BEFORE).some((note) => note.includes("ShopeePay")), false);

section("Phần không đổi so với kỳ 2026-11-01");
check("MB = 0,3", points(accountsOf(["MB"])), 0.3);
check("MSBb + SHB = 0,4", points(accountsOf(["MSBb", "SHB"])), 0.4);
check("MB + TPB + MSBa = 1,2", points(accountsOf(["MB", "TPB", "MSBa"])), 1.2);
check("Phòng Y, MB + TPB = 0,8", points(accountsOf(["MB", "TPB"], AT, PHONG_Y)), 0.8);
check("TCB vẫn ngoài thể lệ", bankTierFor("TCB", AT), null);
check("SHB + LPB vẫn là Combo 1 của SHB", points(accountsOf(["SHB", "LPB"])), 0.2);

/* ── Tổng kết ────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} ca đạt`);
if (failures.length > 0) {
  console.log(`  ${failures.length} ca không đạt:`);
  for (const f of failures) console.log(`    ${f}`);
  process.exit(1);
}
