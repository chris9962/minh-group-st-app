/**
 * Ca thử cho kỳ luật **2026-09** — chạy cùng `bun run test:rules`.
 *
 * File riêng, không gộp vào `test-rules.ts`: file kia ghim kỳ 2026-08 và kỳ đó
 * đóng băng. Gộp hai kỳ vào một file thì mỗi lần thêm kỳ mới lại phải đọc lại
 * toàn bộ ca cũ để biết ca nào còn đúng.
 *
 * Điểm KPI dính tới lương, nên ca thử bám SÁT `mgst-the-le/2026-09.md`: đủ 13
 * dòng bảng điểm, tám bậc quà, ba lưu ý, hai bảng điểm hộ kinh doanh, và bảy
 * giả định của mục 6.
 */
import {
  bankTierFor,
  bankingPointsFor,
  giftFor,
  hasRulesFor,
  type GiftResult,
  type HouseholdKind,
  type ScoringAccount,
} from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-09";

const PERIOD = "2026-09";
const AT = `${PERIOD}-15`;

type Value = number | boolean | string | null;

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: Value, expected: Value): void {
  if (Object.is(actual, expected)) {
    passed += 1;
    return;
  }
  failures.push(`${name}\n      mong ${expected} · nhận ${actual}`);
}

/** So danh sách mã, KHÔNG theo thứ tự — thứ tự trong rổ là việc của giao diện. */
function checkCodes(name: string, actual: string[], expected: string[]): void {
  check(name, [...actual].sort().join(" · "), [...expected].sort().join(" · "));
}

function section(title: string): void {
  console.log(`\n  ${title}`);
}

/** Mặc định: đã cài app, mở giữa tháng 9 — hai thứ đúng với đa số ca. */
const account = (
  customerId: string,
  bankCode: string,
  opts: { app?: boolean; date?: string; household?: HouseholdKind } = {},
): ScoringAccount => ({
  customerId,
  bankCode,
  appInstalled: opts.app ?? true,
  openedDate: opts.date ?? AT,
  /** Ô chọn "Mở tài khoản CNKD / HKD" trên dòng VPa hoặc VPb — mặc định không tick. */
  household: opts.household ?? "none",
});

/**
 * Điểm của cả người, qua đúng cửa vào thật (`src/rules/index.ts`).
 *
 * `granted` là món quà từng khách đã nhận — bỏ trống nghĩa là chưa phát gì.
 */
const points = (
  accounts: ScoringAccount[],
  yearMonth = PERIOD,
  granted: Record<string, string | null> = {},
): number => bankingPointsFor(accounts, yearMonth, new Map(Object.entries(granted)));

/* ── Mục 2 · bảng điểm — phải đủ cả 13 dòng ─────────────────────────── */

section("Bảng điểm Combo 3 (7 dòng)");
check("03 ưu tiên", comboPointsFor(["MB", "VPa", "MSBa"]), 1.2);
check("02 ưu tiên + 01 khác", comboPointsFor(["MB", "VPa", "LPB"]), 1.0);
check("02 ưu tiên + 01 hạn chế", comboPointsFor(["MB", "VPa", "VPb"]), 0.9);
check("01 ưu tiên + 02 khác", comboPointsFor(["MB", "LPB", "TPB"]), 0.8);
check("01 ưu tiên + 01 khác + 01 hạn chế", comboPointsFor(["MB", "LPB", "VPb"]), 0.7);
check("03 khác", comboPointsFor(["LPB", "TPB", "VIB"]), 0.7);
check("02 khác + 01 hạn chế", comboPointsFor(["LPB", "TPB", "VPb"]), 0.5);

section("Bảng điểm Combo 2 (3 dòng)");
check("02 ưu tiên", comboPointsFor(["MB", "VPa"]), 0.7);
check("01 ưu tiên + 01 khác", comboPointsFor(["MB", "LPB"]), 0.5);
check("02 khác", comboPointsFor(["MSBb", "BIDV"]), 0.4);

/**
 * Combo 1 là mục MỚI của kỳ này. Kỳ 2026-08 cho khách mở 1 tài khoản 0 điểm.
 *
 * Dòng "Bank hạn chế (B2b) + CNKD = 1,0" KHÔNG nằm ở đây: 1,0 đó là tổng điểm
 * của khách, gồm 0 điểm tổ hợp cộng 1,0 điểm CNKD. Ca thử của nó ở mục 4c.
 */
section("Bảng điểm Combo 1 (3 dòng) — mới");
check("01 ưu tiên · MB", comboPointsFor(["MB"]), 0.3);
check("01 ưu tiên · VPa", comboPointsFor(["VPa"]), 0.3);
check("01 khác · LPB", comboPointsFor(["LPB"]), 0.2);
check("01 hạn chế đứng một mình không có điểm tổ hợp", comboPointsFor(["VPb"]), 0);
check("không tài khoản nào", comboPointsFor([]), 0);

section("Thứ tự nhập không đổi điểm");
check("VPa trước MB", comboPointsFor(["VPa", "MB"]), 0.7);
check("hạn chế đứng đầu", comboPointsFor(["VPb", "TPB", "LPB"]), 0.5);
check("khác đứng giữa hai ưu tiên", comboPointsFor(["LPB", "MB", "VPa"]), 1.0);

/* ── Mục 1 · TCB vào nhóm Bank khác ─────────────────────────────────── */

/** Kỳ 2026-08 để TCB ngoài thể lệ: 0 điểm, không vào combo. Kỳ này TCB là Bank khác. */
section("TCB (B5) là Bank khác — mới");
check("hạng của TCB ở kỳ 2026-09", bankTierFor("TCB", AT), "other");
check("hạng của TCB ở kỳ 2026-08 vẫn là ngoài thể lệ", bankTierFor("TCB", "2026-08-15"), null);
check("TCB đứng một mình", comboPointsFor(["TCB"]), 0.2);
check("MB + TCB", comboPointsFor(["MB", "TCB"]), 0.5);
check("TCB + LPB", comboPointsFor(["TCB", "LPB"]), 0.4);
check("MB + VPa + TCB", comboPointsFor(["MB", "VPa", "TCB"]), 1.0);
check("TCB + LPB + TPB", comboPointsFor(["TCB", "LPB", "TPB"]), 0.7);
check("TCB + LPB + VPb", comboPointsFor(["TCB", "LPB", "VPb"]), 0.5);

/* ── Mục 4 lưu ý 1 · Combo 2 không triển khai B4a và B2b ────────────── */

/**
 * Hai mã này vẫn ngoài Combo 2, nhưng từ kỳ này khách KHÔNG còn về 0 điểm: mã
 * còn lại đứng một mình vẫn ăn Combo 1.
 */
section("Lưu ý 1 — MSBa và VPb không vào Combo 2");
check("MB + MSBa rơi xuống Combo 1", comboPointsFor(["MB", "MSBa"]), 0.3);
check("MB + VPb rơi xuống Combo 1", comboPointsFor(["MB", "VPb"]), 0.3);
check("LPB + VPb rơi xuống Combo 1", comboPointsFor(["LPB", "VPb"]), 0.2);
check("MSBa + VPb rơi xuống Combo 1", comboPointsFor(["MSBa", "VPb"]), 0.3);
check("MSBa vẫn vào được Combo 3", comboPointsFor(["MSBa", "LPB", "TPB"]), 0.8);
/** Giả định G4: lưu ý 1 chỉ cấm MSBa ở Combo 2, không cấm ở Combo 1. */
check("G4 · MSBa đứng một mình vẫn được 0,3", comboPointsFor(["MSBa"]), 0.3);

/* ── Mã ngoài thể lệ ────────────────────────────────────────────────── */

section("CNKD · HKD · mã lạ không vào combo");
check("CNKD và HKD", comboPointsFor(["CNKD", "HKD"]), 0);
check("MB + CNKD vẫn là Combo 1", comboPointsFor(["MB", "CNKD"]), 0.3);
check("mã lạ hoàn toàn", comboPointsFor(["MB", "VPa", "KHONG-CO-THAT"]), 0.7);

/* ── Trùng mã và dư tài khoản ───────────────────────────────────────── */

section("Trùng mã ngân hàng");
check("MB + MB vẫn là một ngân hàng", comboPointsFor(["MB", "MB"]), 0.3);
check("MB + MB + VPa", comboPointsFor(["MB", "MB", "VPa"]), 0.7);
check("MB + VPa + VPa + LPB", comboPointsFor(["MB", "VPa", "VPa", "LPB"]), 1.0);

section("Dư tài khoản — lấy tổ hợp tốt nhất");
check("MB·VPa·MSBa·VPb", comboPointsFor(["MB", "VPa", "MSBa", "VPb"]), 1.2);
check("MB·VPa·VPb·LPB bỏ VPb", comboPointsFor(["MB", "VPa", "VPb", "LPB"]), 1.0);
check("LPB·TPB·VIB·VPb bỏ VPb", comboPointsFor(["LPB", "TPB", "VIB", "VPb"]), 0.7);
check("năm tài khoản", comboPointsFor(["MB", "VPa", "MSBa", "LPB", "VPb"]), 1.2);
check("trần mỗi khách là 1.2", comboPointsFor(["MB", "VPa", "MSBa", "LPB", "TPB", "VIB"]), 1.2);

/* ── Mục 4c · điểm CNKD ─────────────────────────────────────────────── */

/**
 * CNKD có ĐÚNG MỘT mức: 1,0. Kế toán chốt 2026-09-02.
 *
 * Kỳ 2026-08 có ba mức 1,5 / 1,0 / 0,7. Kỳ này bỏ 1,5 lẫn 0,7, và điều kiện duy
 * nhất còn lại là khách phải mở `VPa` hoặc `VPb`.
 */
section("Điểm CNKD — mục 4c, một mức 1,0");
check(
  "VPa + CNKD, 1 ngân hàng — 0,3 tổ hợp + 1,0 CNKD",
  points([account("kh1", "VPa"), account("kh1", "CNKD")]),
  1.3,
);
check(
  "ô chọn trên dòng VPa tính y hệt tài khoản CNKD riêng",
  points([account("kh1", "VPa", { household: "CNKD" })]),
  1.3,
);
check(
  "MB + VPa kèm CNKD — 0,7 tổ hợp + 1,0 CNKD",
  points([account("kh1", "MB"), account("kh1", "VPa", { household: "CNKD" })]),
  1.7,
);
check(
  "MB + VPa + MSBa kèm CNKD — 1,2 tổ hợp + 1,0 CNKD",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa", { household: "CNKD" }),
    account("kh1", "MSBa"),
  ]),
  2.2,
);
check(
  "VPa + MSBa kèm CNKD — Combo 1 cho 0,3, CNKD cho 1,0",
  points([account("kh1", "VPa", { household: "CNKD" }), account("kh1", "MSBa")]),
  1.3,
);
check(
  "hai tài khoản CÙNG một ngân hàng vẫn đếm là 1",
  points([
    account("kh1", "VPa", { household: "CNKD" }),
    account("kh1", "VPa", { household: "CNKD" }),
  ]),
  1.3,
);
check(
  "tài khoản CNKD riêng không cộng vào số ngân hàng",
  points([account("kh1", "VPa"), account("kh1", "CNKD")]),
  1.3,
);
check(
  "không CNKD, không HKD thì chỉ còn điểm tổ hợp",
  points([account("kh1", "VPa")]),
  0.3,
);

/**
 * Lưu ý 3 của kỳ này: CNKD chọn `VPBa` hoặc `VPBb`. Kỳ 2026-08 chỉ nhận `VPa`.
 *
 * Giả định G3: dòng "Bank hạn chế (B2b) + CNKD = 1,0" của bảng mục 2 là TỔNG
 * điểm khách, không phải điểm tổ hợp. Combo 1 hạng hạn chế cho 0, CNKD cho 1,0.
 */
section("Lưu ý 3 — CNKD đi kèm VPa hoặc VPb");
check(
  "G3 · VPb + CNKD ra đúng 1,0 như bảng mục 2",
  points([account("kh1", "VPb", { household: "CNKD" })]),
  1.0,
);
check(
  "VPb + CNKD ghi bằng tài khoản riêng cũng ra 1,0",
  points([account("kh1", "VPb"), account("kh1", "CNKD")]),
  1.0,
);
check(
  "VPb đứng một mình, không CNKD — không điểm nào",
  points([account("kh1", "VPb")]),
  0,
);
check(
  "MB + VPb kèm CNKD — Combo 1 cho 0,3, CNKD cho 1,0",
  points([account("kh1", "MB"), account("kh1", "VPb", { household: "CNKD" })]),
  1.3,
);
check(
  "VPb + LPB + TPB kèm CNKD — giữ Combo 3 (0,5) chứ không tụt về Combo 1",
  points([
    account("kh1", "VPb", { household: "CNKD" }),
    account("kh1", "LPB"),
    account("kh1", "TPB"),
  ]),
  1.5,
);
/** VPa và VPb cùng mức CNKD 1,0; chênh 0,3 là do điểm TỔ HỢP, không do CNKD. */
check(
  "CNKD kèm VPa — 0,3 tổ hợp + 1,0 CNKD",
  points([account("kh1", "VPa", { household: "CNKD" })]),
  1.3,
);
check(
  "CNKD kèm VPb — 0 tổ hợp + 1,0 CNKD",
  points([account("kh1", "VPb", { household: "CNKD" })]),
  1.0,
);

section("Điểm CNKD đòi ngân hàng chủ VPa hoặc VPb");
check(
  "MB + MSBa + CNKD riêng, không VPa lẫn VPb — không có điểm CNKD",
  points([account("kh1", "MB"), account("kh1", "MSBa"), account("kh1", "CNKD")]),
  0.3,
);
check(
  "MB + MSBb kèm CNKD, không VPa lẫn VPb — chỉ còn điểm tổ hợp",
  points([account("kh1", "MB", { household: "CNKD" }), account("kh1", "MSBb")]),
  0.5,
);

/**
 * Món khách đã nhận KHÔNG còn đổi điểm nào — Kế toán chốt 2026-09-02.
 *
 * Kỳ 2026-08 phát Mì hoặc Nón cho khách CNKD một ngân hàng thì điểm xuống 0,7.
 * Mức nền 1,5 đã bỏ nên mốc đó cũng mất.
 */
section("Món đã nhận KHÔNG đổi điểm");
check(
  "phát Mì → vẫn 1,3",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh1: "QUA-MI" }),
  1.3,
);
check(
  "phát Nón → vẫn 1,3",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh1: "QUA-NON-BH" }),
  1.3,
);
check(
  "phát Loa → vẫn 1,3",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh1: "QUA-LOA" }),
  1.3,
);
check(
  "khách từ chối quà → vẫn 1,3",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh1: null }),
  1.3,
);
check(
  "khách CNKD mở từ 2 ngân hàng, phát Mì cũng giữ 1,0",
  points([account("kh1", "MB"), account("kh1", "VPa", { household: "CNKD" })], PERIOD, {
    kh1: "QUA-MI",
  }),
  1.7,
);
check(
  "khách CNKD kèm VPb phát Mì cũng giữ 1,0",
  points([account("kh1", "VPb", { household: "CNKD" })], PERIOD, { kh1: "QUA-MI" }),
  1.0,
);
check(
  "món của khách khác không đụng điểm khách này",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh2: "QUA-MI" }),
  1.3,
);

/* ── Mục 4d · điểm HKD ──────────────────────────────────────────────── */

/**
 * HKD 3,0 điểm — yêu cầu 2026-09-02. Kỳ 2026-08 cho HKD 0 điểm.
 *
 * ⚠️ HKD chỉ tính khi khách mở `VPa` — Kế toán chốt 2026-09-02: *"HKD luôn đi
 * kèm VPa. VPb không có HKD, VPb chỉ có CNKD"*. Ghi HKD cho khách không mở
 * `VPa` là dữ liệu sai, khách đó được 0 điểm HKD.
 */
section("Điểm HKD — mục 4d, chỉ tính khi kèm VPa");
check(
  "VPa + HKD — 0,3 tổ hợp + 3,0 HKD",
  points([account("kh1", "VPa", { household: "HKD" })]),
  3.3,
);
check(
  "HKD không kèm VPa — 0 điểm HKD, chỉ còn điểm tổ hợp",
  points([account("kh1", "MB"), account("kh1", "MSBb"), account("kh1", "HKD")]),
  0.5,
);
check(
  "HKD một mình, không ngân hàng nào — 0 điểm",
  points([account("kh1", "HKD")]),
  0,
);
check(
  "VPb + HKD — VPb không nhận HKD nên 0 điểm",
  points([account("kh1", "VPb", { household: "HKD" })]),
  0,
);
check(
  "HKD không đổi theo số ngân hàng",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa", { household: "HKD" }),
    account("kh1", "MSBa"),
  ]),
  4.2,
);
check(
  "phát Mì không hạ điểm HKD",
  points([account("kh1", "VPa", { household: "HKD" })], PERIOD, { kh1: "QUA-MI" }),
  3.3,
);
check(
  "phát Nón không hạ điểm HKD",
  points([account("kh1", "VPa", { household: "HKD" })], PERIOD, { kh1: "QUA-NON-BH" }),
  3.3,
);

/**
 * Giả định G2: khách có cả hai mã thì lấy MỨC CAO HƠN, không cộng dồn.
 *
 * Kỳ 2026-08 ưu tiên CNKD vì HKD 0 điểm. Lý do đó mất khi HKD lên 3,0.
 */
section("G2 · khách có cả CNKD lẫn HKD");
check(
  "lấy 3,0 của HKD, không lấy 1,0 của CNKD",
  points([account("kh1", "VPa", { household: "HKD" }), account("kh1", "CNKD")]),
  3.3,
);
check(
  "không cộng dồn 3,0 với 1,0",
  points([account("kh1", "VPa", { household: "CNKD" }), account("kh1", "HKD")]),
  3.3,
);
check(
  "phát Mì cũng không kéo xuống, vì mức thắng là HKD",
  points([account("kh1", "VPa", { household: "HKD" }), account("kh1", "CNKD")], PERIOD, {
    kh1: "QUA-MI",
  }),
  3.3,
);

/* ── Câu 7.8 · chỉ VPa và MSBa mới đòi cài app ──────────────────────── */

section("Điều kiện cài app KHÔNG áp cho điểm");
check(
  "VPa chưa cài vẫn vào tổ hợp",
  points([account("kh1", "MB"), account("kh1", "VPa", { app: false }), account("kh1", "LPB")]),
  1.0,
);
check(
  "cả hai bank đòi app đều chưa cài vẫn ra điểm đủ",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa", { app: false }),
    account("kh1", "MSBa", { app: false }),
  ]),
  1.2,
);
check(
  "VPa chưa cài vẫn ăn Combo 1",
  points([account("kh1", "VPa", { app: false })]),
  0.3,
);

/* ── Câu 7.11 · gom theo khách, không gom theo người ─────────────────── */

section("Gom theo khách");
check(
  "hai khách cộng lại",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa"),
    account("kh1", "MSBa"),
    account("kh2", "LPB"),
    account("kh2", "TPB"),
  ]),
  1.6,
);
check(
  "mỗi khách một tài khoản thì mỗi khách một Combo 1",
  points([account("kh1", "MB"), account("kh2", "VPa"), account("kh3", "LPB")]),
  0.8,
);
check(
  "ba khách đều 03 ưu tiên",
  points(
    ["kh1", "kh2", "kh3"].flatMap((kh) => [
      account(kh, "MB"),
      account(kh, "VPa"),
      account(kh, "MSBa"),
    ]),
  ),
  3.6,
);

/* ── Câu 7.13 · combo không nối qua tháng ───────────────────────────── */

section("Chỉ tính tài khoản mở trong tháng");
check(
  "một tài khoản của tháng trước bị loại",
  points([
    account("kh1", "MB", { date: "2026-08-31" }),
    account("kh1", "VPa"),
    account("kh1", "LPB"),
  ]),
  0.5,
);
check(
  "một tài khoản của tháng sau bị loại",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa"),
    account("kh1", "MSBa", { date: "2026-10-01" }),
  ]),
  0.7,
);
check(
  "ngày đầu và ngày cuối tháng đều tính",
  points([
    account("kh1", "MB", { date: "2026-09-01" }),
    account("kh1", "VPa", { date: "2026-09-30" }),
  ]),
  0.7,
);
check(
  "mọi tài khoản đều lệch tháng",
  points([account("kh1", "MB", { date: "2026-08-15" })]),
  0,
);

/* ── Tra file luật theo kỳ ──────────────────────────────────────────── */

/**
 * Luật kỳ này KHÔNG hồi tố về tháng 8. Ba ca dưới ghim lại điều đó bằng chính
 * hai thay đổi lớn nhất: Combo 1 và TCB.
 */
section("Kỳ nào áp luật nào");
check("tháng trước kỳ đầu tiên chưa có luật", hasRulesFor("2026-07"), false);
check("kỳ 2026-08 có luật", hasRulesFor("2026-08"), true);
check("kỳ 2026-09 có luật", hasRulesFor("2026-09"), true);
check("sang năm vẫn dùng luật 2026-09", hasRulesFor("2027-03"), true);
check(
  "tháng 8 KHÔNG có Combo 1 — luật mới không hồi tố",
  points([account("kh1", "MB", { date: "2026-08-10" })], "2026-08"),
  0,
);
check(
  "tháng 8 vẫn để TCB ngoài thể lệ",
  points(
    [account("kh1", "MB", { date: "2026-08-10" }), account("kh1", "TCB", { date: "2026-08-11" })],
    "2026-08",
  ),
  0,
);
check(
  "tháng 8 vẫn cho HKD 0 điểm",
  points([account("kh1", "VPa", { date: "2026-08-10", household: "HKD" })], "2026-08"),
  0,
);
check(
  "sang năm vẫn tính bằng luật 2026-09",
  points(
    [account("kh1", "MB", { date: "2027-03-10" }), account("kh1", "VPa", { date: "2027-03-11" })],
    "2027-03",
  ),
  0.7,
);

/* ── Cộng dồn không được có sai số dấu phẩy động ─────────────────────── */

section("Sai số dấu phẩy động");
check(
  "mười hai khách × 0.3",
  points(Array.from({ length: 12 }, (_, i) => account(`kh${i}`, "MB"))),
  3.6,
);
check(
  "mười hai khách × 0.7",
  points(
    Array.from({ length: 12 }, (_, i) => [account(`kh${i}`, "MB"), account(`kh${i}`, "VPa")]).flat(),
  ),
  8.4,
);
check(
  "trộn 0.3 và 0.2 và 0.7",
  points([
    account("kh1", "MB"),
    account("kh2", "LPB"),
    account("kh3", "MB"),
    account("kh3", "VPa"),
  ]),
  1.2,
);
check(
  "trộn điểm tổ hợp với 3,0 của HKD",
  points([
    account("kh1", "MB"),
    account("kh1", "LPB"),
    account("kh2", "VPa", { household: "HKD" }),
  ]),
  3.8,
);

/* ══ QUÀ TẶNG · mục 3 và mục 4 lưu ý 2 ═══════════════════════════════ */

/**
 * `"VPa"` là đã cài app, `"VPa!"` là chưa cài — dấu chấm than cho ca thử đọc
 * được trong một dòng, không phải cú pháp của luật.
 *
 * Ô chọn CNKD/HKD gắn lên `VPa` hoặc `VPb`, theo lưu ý 3 của kỳ này.
 */
const giftOf = (
  bankCodes: string[],
  opts: {
    channels?: string[];
    department?: string;
    at?: string;
    household?: HouseholdKind;
    granted?: string | null;
  } = {},
): GiftResult => {
  const codes = bankCodes.map((spec) => spec.replace("!", ""));
  const hasHost = codes.includes("VPa") || codes.includes("VPb");
  const accounts = bankCodes.map((spec) => {
    const bankCode = spec.replace("!", "");
    return account("kh1", bankCode, {
      app: !spec.endsWith("!"),
      household: bankCode === "VPa" || bankCode === "VPb" ? opts.household : undefined,
    });
  });
  // Khách không mở VPa lẫn VPb thì CNKD/HKD ghi thành tài khoản riêng (câu 7.16).
  if (opts.household && !hasHost) accounts.push(account("kh1", opts.household));
  const result = giftFor(
    {
      accounts,
      channelCodes: opts.channels ?? [],
      departmentCode: opts.department ?? null,
      grantedItem: opts.granted ?? null,
    },
    opts.at ?? AT,
  );
  if (!result) throw new Error(`Không có luật cho ngày ${opts.at}`);
  return result;
};

const BH_1N = ["BH-1N-XEMAY", "BH-1N-DIEN"];
const BH_2N = ["BH-COMBO-1N", "BH-2N-XEMAY", "BH-2N-DIEN-100K", "BH-1N-DIEN-200K"];
const BH_TH5 = [...BH_2N, ...BH_1N];
const ITEMS_HKD = ["QUA-LOA", "QUA-MICA"];
const ITEMS_HOSPITAL = ["QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"];

section("Bậc thang TH1 → TH8 (8 dòng)");
check("TH1 · Combo 2 có VPa", giftOf(["MB", "VPa"]).caseCode, "TH1");
check("TH2 · Combo 2 không VPa", giftOf(["MB", "LPB"]).caseCode, "TH2");
check("TH3 · Combo 3 có cả MSBa và VPa", giftOf(["MB", "VPa", "MSBa"]).caseCode, "TH3");
check("TH4 · Combo 3 chỉ có MSBa", giftOf(["MB", "MSBa", "LPB"]).caseCode, "TH4");
check("TH5 · Combo 3 chỉ có VPa", giftOf(["MB", "VPa", "LPB"]).caseCode, "TH5");
check("TH6 · Combo 3 không có cả hai", giftOf(["LPB", "TPB", "VIB"]).caseCode, "TH6");
check("TH7 · Combo 1 không VPa", giftOf(["MB"]).caseCode, "TH7");
check("TH8 · Combo 1 có VPa", giftOf(["VPa"]).caseCode, "TH8");

section("Combo 1 — TH7 và TH8, mới");
check("TH7 · bank khác đứng một mình", giftOf(["LPB"]).caseCode, "TH7");
check("TH7 · TCB đứng một mình", giftOf(["TCB"]).caseCode, "TH7");
check("TH7 · 01 năm bảo hiểm", giftOf(["MB"]).insuranceYears, 1);
check("TH7 · không tiền mặt", giftOf(["MB"]).cashTotal, 0);
check("TH8 · KHÔNG có bảo hiểm, 20k thay cho gói", giftOf(["VPa"]).insuranceYears, 0);
check("TH8 · 20k vào VPa", giftOf(["VPa"]).cashTotal, 20_000);
check("TH8 · điểm tổ hợp của Combo 1", giftOf(["VPa"]).comboPoints, 0.3);
checkCodes("G5 · TH7 dùng rổ 1 năm", giftOf(["MB"]).basket.map((i) => i.code), BH_1N);
checkCodes("TH8 · rổ bảo hiểm rỗng", giftOf(["VPa"]).basket.map((i) => i.code), []);
/**
 * `VPa` BẮT BUỘC cài app — Kế toán chốt 2026-09-02. Khác `MB` và `MSBa`: hai mã
 * đó chưa cài app vẫn được TH7.
 */
check("VPa chưa cài app, đứng một mình — KHÔNG có bậc nào", giftOf(["VPa!"]).caseCode, null);
check("VPa chưa cài app — không có bảo hiểm", giftOf(["VPa!"]).insuranceYears, 0);
check("VPa chưa cài app — không có tiền", giftOf(["VPa!"]).cashTotal, 0);
check(
  "VPa chưa cài app — nói rõ lý do cho nhân viên",
  giftOf(["VPa!"]).explain.some((line) => line.includes("bắt buộc cài app")),
  true,
);
check("MB chưa cài app vẫn được TH7", giftOf(["MB!"]).caseCode, "TH7");
check("MSBa chưa cài app, đứng một mình — KHÔNG có bậc nào", giftOf(["MSBa!"]).caseCode, null);
check("MSBa chưa cài app — không có bảo hiểm", giftOf(["MSBa!"]).insuranceYears, 0);
check("MSBa chưa cài app vẫn được 0,3 điểm Combo 1", points([account("kh1", "MSBa", { app: false })]), 0.3);
check("VPa chưa cài kèm MB — Combo 2 hợp lệ, ra TH2 vì VPa chưa cài", giftOf(["VPa!", "MB"]).caseCode, "TH2");
check("VPa chưa cài kèm MSBa chưa cài — hai ngân hàng, vẫn không có app nào", giftOf(["VPa!", "MSBa!"]).caseCode, "TH7");
check(
  "VPa chưa cài kèm MSBa đã cài — hai ngân hàng nên vẫn có bậc",
  giftOf(["VPa!", "MSBa"]).caseCode,
  "TH7",
);
check(
  "MSBa chưa cài app — nói rõ lý do cho nhân viên",
  giftOf(["MSBa!"]).explain.some((line) => line.includes("phải cài app")),
  true,
);
check(
  "VPa chưa cài kèm CNKD vẫn không có bậc nào",
  giftOf(["VPa!"], { household: "CNKD" }).caseCode,
  null,
);
check("VPa chưa cài app vẫn được 0,3 điểm Combo 1", points([account("kh1", "VPa", { app: false })]), 0.3);
check(
  "VPb đứng một mình, không CNKD — chưa đủ bậc nào",
  giftOf(["VPb"]).caseCode,
  null,
);
/** VPb chỉ nhận CNKD. `VPb` + HKD là dữ liệu sai, không đạt bậc nào. */
check("VPb kèm HKD KHÔNG đạt bậc nào", giftOf(["VPb"], { household: "HKD" }).caseCode, null);
check("VPb kèm HKD không có bảo hiểm", giftOf(["VPb"], { household: "HKD" }).insuranceYears, 0);
check("VPb kèm HKD không có tiền mặt", giftOf(["VPb"], { household: "HKD" }).cashTotal, 0);
check(
  "G3 · VPb kèm CNKD là tổ hợp Combo 1, được TH7",
  giftOf(["VPb"], { household: "CNKD" }).caseCode,
  "TH7",
);
check(
  "G3 · VPb kèm CNKD có 01 năm bảo hiểm",
  giftOf(["VPb"], { household: "CNKD" }).insuranceYears,
  1,
);
check(
  "G3 · VPb kèm CNKD không có tiền mặt",
  giftOf(["VPb"], { household: "CNKD" }).cashTotal,
  0,
);
check(
  "G3 · VPb kèm CNKD có 0 điểm tổ hợp",
  giftOf(["VPb"], { household: "CNKD" }).comboPoints,
  0,
);
check(
  "G3 · VPb + LPB + TPB kèm CNKD vẫn là TH6, không tụt xuống TH7",
  giftOf(["VPb", "LPB", "TPB"], { household: "CNKD" }).caseCode,
  "TH6",
);
check(
  "G3 · và vẫn giữ 02 năm bảo hiểm",
  giftOf(["VPb", "LPB", "TPB"], { household: "CNKD" }).insuranceYears,
  2,
);
check("khách không mở gì cả", giftOf([]).caseCode, null);
check("chỉ có mã ngoài thể lệ", giftOf(["CNKD"]).caseCode, null);

section("TCB vào bậc quà — mới");
check("MB + TCB là Combo 2", giftOf(["MB", "TCB"]).caseCode, "TH2");
check("VPa + TCB là TH1", giftOf(["VPa", "TCB"]).caseCode, "TH1");
check("VPa + TCB được 20k", giftOf(["VPa", "TCB"]).cashTotal, 20_000);
check("MB + VPa + TCB là TH5", giftOf(["MB", "VPa", "TCB"]).caseCode, "TH5");

section("Số năm bảo hiểm theo từng trường hợp");
check("TH1 · 1 năm", giftOf(["MB", "VPa"]).insuranceYears, 1);
check("TH2 · 1 năm", giftOf(["MB", "LPB"]).insuranceYears, 1);
check("TH3 · 1 năm", giftOf(["MB", "VPa", "MSBa"]).insuranceYears, 1);
check("TH4 · 1 năm", giftOf(["MB", "MSBa", "LPB"]).insuranceYears, 1);
check("TH5 · 2 năm", giftOf(["MB", "VPa", "LPB"]).insuranceYears, 2);
check("TH6 · 2 năm", giftOf(["LPB", "TPB", "VIB"]).insuranceYears, 2);
checkCodes(
  "TH5 · thêm hai gói 1 năm",
  giftOf(["MB", "VPa", "LPB"]).basket.map((item) => item.code),
  BH_TH5,
);
checkCodes(
  "TH6 · giữ rổ 2 năm",
  giftOf(["LPB", "TPB", "VIB"]).basket.map((item) => item.code),
  BH_2N,
);

section("Tiền mặt");
check("TH1 · 20k", giftOf(["MB", "VPa"]).cashTotal, 20_000);
check("TH2 · không tiền", giftOf(["MB", "LPB"]).cashTotal, 0);
check("TH3 · 70k", giftOf(["MB", "VPa", "MSBa"]).cashTotal, 70_000);
check("TH4 · 50k", giftOf(["MB", "MSBa", "LPB"]).cashTotal, 50_000);
check("TH5 · 20k", giftOf(["MB", "VPa", "LPB"]).cashTotal, 20_000);
check("TH6 · không tiền", giftOf(["LPB", "TPB", "VIB"]).cashTotal, 0);
check("TH7 · không tiền", giftOf(["LPB"]).cashTotal, 0);
check("TH8 · 20k", giftOf(["VPa"]).cashTotal, 20_000);
check(
  "VPa chưa cài app trong Combo 3 thì không có 20k",
  giftOf(["MB", "VPa!", "LPB"]).cashTotal,
  0,
);

/* ── Mục 4b · món thêm ──────────────────────────────────────────────── */

/**
 * Loa và Bảng mica: CHỈ khách có `HKD` — Kế toán chốt 2026-09-02.
 *
 * Kỳ 2026-08 đòi hai vế, khách mở `VPa` và khách có `CNKD` hoặc `HKD`. Kỳ này
 * bỏ cả hai vế đó.
 */
section("Loa và Bảng mica — chỉ HKD");
checkCodes(
  "VPa kèm HKD",
  giftOf(["VPa"], { household: "HKD" }).basket.map((i) => i.code),
  ITEMS_HKD,
);
checkCodes(
  "VPb kèm HKD — rổ RỖNG, vì VPb không nhận HKD",
  giftOf(["VPb"], { household: "HKD" }).basket.map((i) => i.code),
  [],
);
checkCodes(
  "MB kèm HKD — không mở VPa nên KHÔNG có Loa lẫn Bảng mica",
  giftOf(["MB"], { household: "HKD" }).basket.map((i) => i.code),
  BH_1N,
);
checkCodes(
  "MB + VPa kèm HKD — có VPa nên có Loa và Bảng mica",
  giftOf(["MB", "VPa"], { household: "HKD" }).basket.map((i) => i.code),
  [...BH_1N, ...ITEMS_HKD],
);
checkCodes(
  "VPa kèm CNKD — CNKD KHÔNG còn Loa và Bảng mica",
  giftOf(["VPa"], { household: "CNKD" }).basket.map((i) => i.code),
  [],
);
checkCodes(
  "VPb kèm CNKD — chỉ còn hai gói bảo hiểm của TH7",
  giftOf(["VPb"], { household: "CNKD" }).basket.map((i) => i.code),
  BH_1N,
);
/** Khách VPa một mình, không HKD, không thuộc nhóm quà: rổ RỖNG, chỉ có 20k. */
checkCodes(
  "VPa không kèm gì thì rổ rỗng hoàn toàn",
  giftOf(["VPa"]).basket.map((i) => i.code),
  [],
);

/**
 * Quy đổi quà của Phòng Y ĐÒI BẬC TH5 hoặc TH6 — Kế toán chốt 2026-09-02, lật
 * chốt 2026-08-24.
 *
 * Nguyên văn: *"phòng Y (kênh bệnh viện) chỉ được quy đổi quà tặng tại TH5,
 * TH6 thôi, còn combo 1, 2 thì không"*.
 */
section("Quy đổi quà của Phòng Y — chỉ TH5 và TH6");
checkCodes(
  "TH5 · Phòng Y có thêm Bảng mica",
  giftOf(["MB", "VPa", "LPB"], { department: "PHONG-Y" }).basket.map((i) => i.code),
  [...BH_TH5, ...ITEMS_HOSPITAL, "QUA-MICA"],
);
checkCodes(
  "TH6 · Phòng Y có thêm Bảng mica",
  giftOf(["LPB", "TPB", "VIB"], { department: "PHONG-Y" }).basket.map((i) => i.code),
  [...BH_2N, ...ITEMS_HOSPITAL, "QUA-MICA"],
);
checkCodes(
  "TH5 · phòng Dự án không có Bảng mica",
  giftOf(["MB", "VPa", "LPB"], { department: "PHONG-DU-AN" }).basket.map((i) => i.code),
  [...BH_TH5, ...ITEMS_HOSPITAL],
);
checkCodes(
  "TH6 · kênh Bệnh viện không có Bảng mica",
  giftOf(["LPB", "TPB", "VIB"], { channels: ["KENH-BENH-VIEN"] }).basket.map((i) => i.code),
  [...BH_2N, ...ITEMS_HOSPITAL],
);

section("Bậc khác TH5 và TH6 KHÔNG được quy đổi quà");
checkCodes(
  "TH7 · Phòng Y không có Mì lẫn Nón",
  giftOf(["MB"], { department: "PHONG-Y" }).basket.map((i) => i.code),
  BH_1N,
);
checkCodes(
  "TH8 · Phòng Y không có Mì lẫn Nón",
  giftOf(["VPa"], { department: "PHONG-Y" }).basket.map((i) => i.code),
  [],
);
checkCodes(
  "TH1 · Phòng Y không có Mì lẫn Nón",
  giftOf(["MB", "VPa"], { department: "PHONG-Y" }).basket.map((i) => i.code),
  BH_1N,
);
checkCodes(
  "TH2 · kênh Bệnh viện không có Mì lẫn Nón",
  giftOf(["MB", "LPB"], { channels: ["KENH-BENH-VIEN"] }).basket.map((i) => i.code),
  BH_1N,
);
checkCodes(
  "TH3 · Phòng Y không có Mì lẫn Nón",
  giftOf(["MB", "VPa", "MSBa"], { department: "PHONG-Y" }).basket.map((i) => i.code),
  BH_1N,
);
checkCodes(
  "TH4 · phòng Dự án không có Mì lẫn Nón",
  giftOf(["MB", "MSBa", "LPB"], { department: "PHONG-DU-AN" }).basket.map((i) => i.code),
  BH_1N,
);
checkCodes(
  "khách chưa đủ bậc nào KHÔNG còn nhận món thêm của Phòng Y",
  giftOf(["VPb"], { department: "PHONG-Y" }).basket.map((i) => i.code),
  [],
);
checkCodes(
  "VPb kèm HKD ở Phòng Y — rổ RỖNG hoàn toàn",
  giftOf(["VPb"], { household: "HKD", department: "PHONG-Y" }).basket.map((i) => i.code),
  [],
);
checkCodes(
  "TH8 kèm HKD, Phòng Y — chỉ có Loa và Bảng mica",
  giftOf(["VPa"], { household: "HKD", department: "PHONG-Y" }).basket.map((i) => i.code),
  ITEMS_HKD,
);

/* ── Tiền mặt không phụ thuộc món khách chọn ────────────────────────── */

/**
 * Kế toán bỏ luật "chọn Mì hoặc Nón thì mất 20k" ngày 2026-09-02.
 *
 * Kỳ 2026-08 khách CNKD mở đúng một `VPa` mà nhận Mì hoặc Nón thì mất 20k. Các
 * ca dưới ghim lại rằng ca đó nay giữ nguyên tiền, và ghim cả nhóm khách rộng
 * hơn để không ai dựng lại luật cũ bằng đường khác.
 */
const soloVPa = (granted?: string | null): GiftResult =>
  giftOf(["VPa"], { household: "CNKD", department: "PHONG-Y", granted });

section("Món khách nhận KHÔNG làm mất tiền");
check("chưa phát gì → 20k", soloVPa().cashTotal, 20_000);
check("từ chối nhận quà → 20k", soloVPa("DECLINED").cashTotal, 20_000);
check("đã nhận Mì → vẫn 20k", soloVPa("QUA-MI").cashTotal, 20_000);
check("đã nhận Nón → vẫn 20k", soloVPa("QUA-NON-BH").cashTotal, 20_000);
check("đã nhận Loa → vẫn 20k", soloVPa("QUA-LOA").cashTotal, 20_000);
check("đã nhận Bảng mica → vẫn 20k", soloVPa("QUA-MICA").cashTotal, 20_000);
check("khách HKD đã nhận Mì → vẫn 20k", giftOf(["VPa"], { household: "HKD", granted: "QUA-MI" }).cashTotal, 20_000);
check("khách không CNKD không HKD đã nhận Mì → vẫn 20k", giftOf(["VPa"], { granted: "QUA-MI" }).cashTotal, 20_000);
check("TH1 đã nhận Mì → vẫn 20k", giftOf(["MB", "VPa"], { granted: "QUA-MI" }).cashTotal, 20_000);
check("TH3 đã nhận Nón → vẫn 70k", giftOf(["MB", "VPa", "MSBa"], { granted: "QUA-NON-BH" }).cashTotal, 70_000);
check(
  "TH5 Phòng Y đã nhận Mì → vẫn 20k",
  giftOf(["MB", "VPa", "LPB"], { department: "PHONG-Y", granted: "QUA-MI" }).cashTotal,
  20_000,
);
check("không còn câu nhắc mất tiền", soloVPa().explain.some((l) => l.includes("mất")), false);

/** Số tiền gắn sẵn trên từng món — hộp thoại phát quà đọc nó để hiện số. */
const cashIfChosen = (result: GiftResult, code: string): number =>
  result.basket.find((item) => item.code === code)?.cashIfChosen ?? -1;

section("Mọi món trong rổ cùng một số tiền");
check(
  "TH5 Phòng Y · chọn Mì vẫn ghi 20k",
  cashIfChosen(giftOf(["MB", "VPa", "LPB"], { department: "PHONG-Y" }), "QUA-MI"),
  20_000,
);
check(
  "TH5 Phòng Y · chọn Nón vẫn ghi 20k",
  cashIfChosen(giftOf(["MB", "VPa", "LPB"], { department: "PHONG-Y" }), "QUA-NON-BH"),
  20_000,
);
check(
  "TH5 Phòng Y · mọi món đều 20k",
  giftOf(["MB", "VPa", "LPB"], { department: "PHONG-Y" }).basket.every((i) => i.cashIfChosen === 20_000),
  true,
);
check(
  "TH8 kèm HKD · chọn Loa ghi 20k",
  cashIfChosen(giftOf(["VPa"], { household: "HKD" }), "QUA-LOA"),
  20_000,
);
check(
  "TH6 Phòng Y · không tiền thì mọi món đều 0đ",
  giftOf(["LPB", "TPB", "VIB"], { department: "PHONG-Y" }).basket.every((i) => i.cashIfChosen === 0),
  true,
);

/* ── Kết quả ────────────────────────────────────────────────────────── */

console.log("");
if (failures.length === 0) {
  console.log(`✓ ${passed} ca đạt (kỳ ${PERIOD}).\n`);
  process.exit(0);
}

console.log(`✗ ${failures.length} ca HỎNG (${passed} ca đạt) — kỳ ${PERIOD}:\n`);
for (const failure of failures) console.log(`  · ${failure}\n`);
process.exit(1);
