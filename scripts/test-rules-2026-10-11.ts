/**
 * Ca thử cho kỳ luật **2026-10-11**, chạy cùng `bun run test:rules`.
 *
 * Chỉ thử điểm KHÁC kỳ 2026-10-01: tổ hợp ngoại lệ `TPB` + `LPB` thành Combo 2,
 * 0,3 điểm. Phần không đổi đã có ca ở `test-rules-2026-10-01.ts`.
 */
import {
  bankingPointsFor,
  comboPointsAt,
  comboRowsAt,
  giftFor,
  multiBankComboCountFor,
  openNotesAt,
  type GiftResult,
  type ScoringAccount,
} from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-10-11";

const AT = "2026-10-11";
const BEFORE = "2026-10-10";

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

const account = (customerId: string, bankCode: string, date = AT): ScoringAccount => ({
  customerId,
  bankCode,
  appInstalled: true,
  openedDate: date,
  household: "none",
});

const accountsOf = (codes: string[], date = AT) => codes.map((code) => account("k", code, date));

const gift = (accounts: ScoringAccount[], at = AT): GiftResult =>
  giftFor({ accounts, channelCodes: [], departmentCode: null, grantedItem: null }, at)!;

section("TPB + LPB thành Combo 2, 0,3 điểm");
check("TPB + LPB = 0,3", comboPointsFor(["TPB", "LPB"]), 0.3);
check("thứ tự nhập không đổi kết quả", comboPointsFor(["LPB", "TPB"]), 0.3);
check("trước 2026-10-11 vẫn là Combo 1 của TPB", comboPointsAt(["TPB", "LPB"], BEFORE), 0.2);
check("điểm KPI tháng 10, hồ sơ ngày 11/10", bankingPointsFor(accountsOf(["TPB", "LPB"]), "2026-10"), 0.3);
check(
  "điểm KPI tháng 10, hồ sơ ngày 10/10",
  bankingPointsFor(accountsOf(["TPB", "LPB"], BEFORE), "2026-10"),
  0.2,
);

section("Cặp bank khác + bank hạn chế khác giữ luật cũ");
check("TPB + BIDV = 0,2", comboPointsFor(["TPB", "BIDV"]), 0.2);
check("TPB + VIB = 0,2", comboPointsFor(["TPB", "VIB"]), 0.2);
check("VPb + LPB = 0,2", comboPointsFor(["VPb", "LPB"]), 0.2);
check("LPB một mình = 0", comboPointsFor(["LPB"]), 0);
check("TPB một mình = 0,2", comboPointsFor(["TPB"]), 0.2);

section("Có bank thứ ba thì Combo 3 cao hơn vẫn thắng");
check("TPB + LPB + VPa = 0,7", comboPointsFor(["TPB", "LPB", "VPa"]), 0.7);
check("TPB + LPB + VPb = 0,5", comboPointsFor(["TPB", "LPB", "VPb"]), 0.5);
check("TPB + LPB + BIDV = 0,4", comboPointsFor(["TPB", "LPB", "BIDV"]), 0.4);
check("VPa + MB vẫn 0 điểm", comboPointsFor(["VPa", "MB"]), 0);

section("Quà theo bảng Combo 2");
const pair = gift(accountsOf(["TPB", "LPB"]));
check("TPB + LPB: TH1", pair.caseCode, "TH1");
check("TPB + LPB: 01 năm BH", pair.insuranceYears, 1);
check("TPB + LPB: không có tiền mặt", pair.cashTotal, 0);
check("TPB + LPB: điểm trên màn quà 0,3", pair.comboPoints, 0.3);

section("Thưởng combo nhân viên điểm ATM");
check("TPB + LPB đếm là một combo", multiBankComboCountFor(accountsOf(["TPB", "LPB"]), "2026-10"), 1);
check(
  "hồ sơ ngày 10/10 không đếm",
  multiBankComboCountFor(accountsOf(["TPB", "LPB"], BEFORE), "2026-10"),
  0,
);

section("Hộp thoại luật chọn ngân hàng");
check(
  "bảng tổ hợp có dòng ngoại lệ",
  (comboRowsAt(AT) ?? []).some((row) => row.label === "TPB + LPB (ngoại lệ)"),
  true,
);
check(
  "kỳ trước không có dòng ngoại lệ",
  (comboRowsAt(BEFORE) ?? []).some((row) => row.label === "TPB + LPB (ngoại lệ)"),
  false,
);
check("câu luật nhắc ngoại lệ", openNotesAt(AT).some((note) => note.includes("TPB + LPB")), true);

/* ── Tổng kết ────────────────────────────────────────────────────────── */

console.log(`\n  ${passed} ca đạt`);
if (failures.length > 0) {
  console.log(`  ${failures.length} ca không đạt:`);
  for (const f of failures) console.log(`    ${f}`);
  process.exit(1);
}
