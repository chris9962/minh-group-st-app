/**
 * Ca thử cho module luật theo kỳ — `bun run test:rules`.
 *
 * Vì sao là script chứ không phải bộ chạy test: dự án không có bộ nào, và thêm
 * `@types/bun` để dùng `bun test` thì nó ghi đè kiểu `fetch` toàn cục, làm
 * `bunx tsc --noEmit` gãy ở `src/app/providers.tsx`. Hàm luật là hàm thuần
 * không đụng database nên chạy thẳng là đủ; đổi lại script này được `tsc` soi
 * y như code ứng dụng.
 *
 * Điểm KPI dính tới lương, nên ca thử bám SÁT `mgst-the-le/2026-08.md`: đủ 10
 * dòng bảng điểm, cả hai lưu ý ở mục 4, và bốn quyết định chốt 07/08.
 */
import {
  bankingPointsFor,
  giftFor,
  hasRulesFor,
  kpiAppliesTo,
  type GiftResult,
  type HouseholdKind,
  type ScoringAccount,
} from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-08";

const PERIOD = "2026-08";

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

/** Mặc định: đã cài app, mở giữa tháng 8 — hai thứ đúng với đa số ca. */
const account = (
  customerId: string,
  bankCode: string,
  opts: { app?: boolean; date?: string; household?: HouseholdKind } = {},
): ScoringAccount => ({
  customerId,
  bankCode,
  appInstalled: opts.app ?? true,
  openedDate: opts.date ?? `${PERIOD}-15`,
  /** Ô chọn "Mở tài khoản CNKD / HKD" trên dòng VPa — mặc định không tick. */
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

/* ── Mục 2 · bảng điểm — phải đủ cả 10 dòng ─────────────────────────── */

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

section("Thứ tự nhập không đổi điểm");
check("VPa trước MB", comboPointsFor(["VPa", "MB"]), 0.7);
check("hạn chế đứng đầu", comboPointsFor(["VPb", "TPB", "LPB"]), 0.5);
check("khác đứng giữa hai ưu tiên", comboPointsFor(["LPB", "MB", "VPa"]), 1.0);

/* ── Mục 4 lưu ý 1 · Combo 2 không triển khai B4a và B2b ────────────── */

section("Lưu ý 1 — MSBa và VPb không vào Combo 2");
check("MB + MSBa", comboPointsFor(["MB", "MSBa"]), 0);
check("MB + VPb", comboPointsFor(["MB", "VPb"]), 0);
check("LPB + VPb", comboPointsFor(["LPB", "VPb"]), 0);
check("MSBa + VPb", comboPointsFor(["MSBa", "VPb"]), 0);
check("MSBa vẫn vào được Combo 3", comboPointsFor(["MSBa", "LPB", "TPB"]), 0.8);

/* ── Câu 7.3 · mở lẻ thì không có điểm ──────────────────────────────── */

section("Không đủ combo");
check("không tài khoản nào", comboPointsFor([]), 0);
check("một tài khoản ưu tiên", comboPointsFor(["MB"]), 0);
check("một tài khoản khác", comboPointsFor(["LPB"]), 0);

/* ── Câu 7.2 · ngân hàng ngoài thể lệ ───────────────────────────────── */

/** Ba mã này không vào COMBO. Điểm riêng của CNKD nằm ở mục 4c, kiểm bên dưới. */
section("TCB · CNKD · HKD không vào combo");
check("MB + TCB", comboPointsFor(["MB", "TCB"]), 0);
check("ba mã ngoài thể lệ", comboPointsFor(["TCB", "CNKD", "HKD"]), 0);
check("MB + VPa + TCB rơi về Combo 2", comboPointsFor(["MB", "VPa", "TCB"]), 0.7);
check("mã lạ hoàn toàn", comboPointsFor(["MB", "VPa", "KHONG-CO-THAT"]), 0.7);

/* ── Mục 4c · điểm CNKD/HKD (chốt 2026-08-24) ───────────────────────── */

/**
 * Bảng bốn dòng của mục 4c, cộng ca "phát quà làm tụt điểm".
 *
 * Đo trên `TÍNH ĐIỂM TỔNG T8.xlsx`: 5.925/5.940 dòng CNKD khớp bảng này, và cả
 * 39 dòng HKD đều 0 điểm.
 */
section("Điểm CNKD/HKD — mục 4c");
check(
  "CNKD đứng một mình, chưa phát quà",
  points([account("kh1", "VPa"), account("kh1", "CNKD")]),
  1.5,
);
check(
  "ô chọn trên dòng VPa tính y hệt tài khoản CNKD riêng",
  points([account("kh1", "VPa", { household: "CNKD" })]),
  1.5,
);
check(
  "CNKD kèm 2 ngân hàng thành tổ hợp — 0,7 combo + 1,0 CNKD",
  points([account("kh1", "MB"), account("kh1", "VPa", { household: "CNKD" })]),
  1.7,
);
check(
  "CNKD kèm 3 ngân hàng — 1,2 combo + 1,0 CNKD",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa", { household: "CNKD" }),
    account("kh1", "MSBa"),
  ]),
  2.2,
);
check("HKD không ra điểm", points([account("kh1", "VPa", { household: "HKD" })]), 0);
check(
  "HKD kèm combo chỉ có điểm combo",
  points([account("kh1", "MB"), account("kh1", "VPa", { household: "HKD" })]),
  0.7,
);
check(
  "khách có cả CNKD lẫn HKD thì tính theo CNKD",
  points([account("kh1", "VPa", { household: "HKD" }), account("kh1", "CNKD")]),
  1.5,
);
check(
  "không CNKD, không combo thì vẫn 0",
  points([account("kh1", "VPa")]),
  0,
);

/**
 * Mức điểm CNKD chọn theo SỐ NGÂN HÀNG khách mở, không theo tổ hợp thắng — đọc
 * thẳng từ công thức ô `AT` của `TÍNH ĐIỂM TỔNG T8.xlsx` (chốt 2026-08-25):
 *
 *     =IF(AND(T="CNKD", AN=1), 1.5, IF(T="CNKD", 1, "0"))
 */
section("Mức điểm CNKD chọn theo SỐ NGÂN HÀNG, không theo tổ hợp");
check(
  "VPa + MSBa: 2 ngân hàng nhưng KHÔNG thành tổ hợp — vẫn là mức 1,0",
  points([account("kh1", "VPa", { household: "CNKD" }), account("kh1", "MSBa")]),
  1.0,
);
check(
  "MB + MSBa: cùng ca, cùng mức 1,0",
  points([account("kh1", "MB"), account("kh1", "MSBa"), account("kh1", "CNKD")]),
  1.0,
);
check(
  "hai tài khoản CÙNG một ngân hàng vẫn đếm là 1 → mức 1,5",
  points([
    account("kh1", "VPa", { household: "CNKD" }),
    account("kh1", "VPa", { household: "CNKD" }),
  ]),
  1.5,
);
check(
  "tài khoản CNKD riêng không cộng vào số ngân hàng",
  points([account("kh1", "VPa"), account("kh1", "CNKD")]),
  1.5,
);

section("Phát Mì hoặc Nón hạ mức điểm CNKD — thông báo Kế toán 2026-08-24");
check(
  "phát Mì → 0,7",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh1: "QUA-MI" }),
  0.7,
);
check(
  "phát Nón → 0,7",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh1: "QUA-NON-BH" }),
  0.7,
);
check(
  "phát Loa thì KHÔNG tụt",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh1: "QUA-LOA" }),
  1.5,
);
check(
  "khách từ chối quà thì KHÔNG tụt",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh1: null }),
  1.5,
);
check(
  "khách CNKD mở từ 2 ngân hàng thì phát Mì cũng giữ 1,0",
  points([account("kh1", "MB"), account("kh1", "VPa", { household: "CNKD" })], PERIOD, {
    kh1: "QUA-MI",
  }),
  1.7,
);
check(
  "khách CNKD 2 ngân hàng không thành tổ hợp, phát Mì cũng giữ 1,0",
  points([account("kh1", "VPa", { household: "CNKD" }), account("kh1", "MSBa")], PERIOD, {
    kh1: "QUA-MI",
  }),
  1.0,
);
check(
  "món của khách khác không đụng điểm khách này",
  points([account("kh1", "VPa", { household: "CNKD" })], PERIOD, { kh2: "QUA-MI" }),
  1.5,
);

/* ── Hai tài khoản cùng một ngân hàng không thành combo ─────────────── */

section("Trùng mã ngân hàng");
check("MB + MB", comboPointsFor(["MB", "MB"]), 0);
check("MB + MB + VPa", comboPointsFor(["MB", "MB", "VPa"]), 0.7);
check("MB + VPa + VPa + LPB", comboPointsFor(["MB", "VPa", "VPa", "LPB"]), 1.0);

/* ── Câu 7.4 · từ 4 tài khoản thì lấy tổ hợp 3 cao điểm nhất ────────── */

section("Dư tài khoản — lấy tổ hợp tốt nhất");
check("MB·VPa·MSBa·VPb", comboPointsFor(["MB", "VPa", "MSBa", "VPb"]), 1.2);
check("MB·VPa·VPb·LPB bỏ VPb", comboPointsFor(["MB", "VPa", "VPb", "LPB"]), 1.0);
check("LPB·TPB·VIB·VPb bỏ VPb", comboPointsFor(["LPB", "TPB", "VIB", "VPb"]), 0.7);
check("năm tài khoản", comboPointsFor(["MB", "VPa", "MSBa", "LPB", "VPb"]), 1.2);
check("trần mỗi khách là 1.2", comboPointsFor(["MB", "VPa", "MSBa", "LPB", "TPB", "VIB"]), 1.2);

/* ── Câu 7.8 · chỉ VPa và MSBa mới đòi cài app ──────────────────────── */

/**
 * ĐIỂM không áp điều kiện cài app — chốt 2026-08-25, thu hẹp chốt 2026-08-07.
 *
 * File `TÍNH ĐIỂM TỔNG T8.xlsx` xử hai cột theo hai cách: cột điểm đếm cả tài
 * khoản chưa cài app, cột quà thì không. Các ca dưới đây ghim lại vế ĐIỂM; vế
 * QUÀ nằm ở mục "Điều kiện cài app CHỈ áp cho quà".
 */
section("Điều kiện cài app KHÔNG áp cho điểm");
check(
  "VPa chưa cài vẫn vào tổ hợp",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa", { app: false }),
    account("kh1", "LPB"),
  ]),
  1.0,
);
check(
  "VPa đã cài → cùng một điểm",
  points([account("kh1", "MB"), account("kh1", "VPa"), account("kh1", "LPB")]),
  1.0,
);
check(
  "MSBa chưa cài vẫn vào tổ hợp",
  points([
    account("kh1", "MB"),
    account("kh1", "MSBa", { app: false }),
    account("kh1", "LPB"),
  ]),
  1.0,
);
check(
  "LPB chưa cài vẫn tính",
  points([
    account("kh1", "MB"),
    account("kh1", "LPB", { app: false }),
    account("kh1", "TPB", { app: false }),
  ]),
  0.8,
);
check(
  "VPb chưa cài vẫn tính",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa"),
    account("kh1", "VPb", { app: false }),
  ]),
  0.9,
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
/**
 * Dòng 2 của `TÍNH ĐIỂM TỔNG T8.xlsx` — `VO VAN CHIEN`. Mở VPa + LPB + MSBa,
 * chỉ cài app VPa, có CNKD. File ghi tổng 2,0 điểm.
 */
check(
  "dòng thật VO VAN CHIEN — khớp cột TỔNG ĐIỂM của file",
  points([
    account("kh1", "VPa", { household: "CNKD" }),
    account("kh1", "LPB"),
    account("kh1", "MSBa", { app: false }),
  ]),
  2.0,
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
  "mỗi khách một tài khoản thì không ai có combo",
  points([account("kh1", "MB"), account("kh2", "VPa"), account("kh3", "LPB")]),
  0,
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
    account("kh1", "MB", { date: "2026-07-31" }),
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
    account("kh1", "MSBa", { date: "2026-09-01" }),
  ]),
  0.7,
);
check(
  "ngày đầu và ngày cuối tháng đều tính",
  points([
    account("kh1", "MB", { date: "2026-08-01" }),
    account("kh1", "VPa", { date: "2026-08-31" }),
  ]),
  0.7,
);
check("mọi tài khoản đều lệch tháng", points([account("kh1", "MB", { date: "2026-07-15" })]), 0);

/* ── Tra file luật theo kỳ ──────────────────────────────────────────── */

section("Kỳ nào áp luật nào");
check("tháng trước kỳ đầu tiên chưa có luật", hasRulesFor("2026-07"), false);
check("kỳ 2026-08 có luật", hasRulesFor("2026-08"), true);
check("tháng sau vẫn dùng luật 2026-08", hasRulesFor("2026-09"), true);
check("sang năm vẫn dùng luật 2026-08", hasRulesFor("2027-03"), true);
check(
  "tháng 7 không tính điểm dù có dữ liệu",
  points([account("kh1", "MB", { date: "2026-07-10" }), account("kh1", "VPa", { date: "2026-07-11" })], "2026-07"),
  0,
);
check(
  "tháng 9 tính bằng luật tháng 8",
  points(
    [account("kh1", "MB", { date: "2026-09-10" }), account("kh1", "VPa", { date: "2026-09-11" })],
    "2026-09",
  ),
  0.7,
);

/* ── Cộng dồn không được có sai số dấu phẩy động ─────────────────────── */

section("Sai số dấu phẩy động");
check(
  "mười hai khách × 0.7",
  points(
    Array.from({ length: 12 }, (_, i) => [account(`kh${i}`, "MB"), account(`kh${i}`, "VPa")]).flat(),
  ),
  8.4,
);
check(
  "trộn 0.7 và 0.5 và 0.4",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa"),
    account("kh2", "MB"),
    account("kh2", "LPB"),
    account("kh3", "MSBb"),
    account("kh3", "BIDV"),
  ]),
  1.6,
);

/* ══ QUÀ TẶNG · mục 3 và mục 4 lưu ý 2 ═══════════════════════════════ */

/**
 * `"VPa"` là đã cài app, `"VPa!"` là chưa cài — dấu chấm than cho ca thử đọc
 * được trong một dòng, không phải cú pháp của luật.
 */
const giftOf = (
  bankCodes: string[],
  opts: { channels?: string[]; department?: string; at?: string } = {},
): GiftResult => {
  const accounts = bankCodes.map((spec) =>
    account("kh1", spec.replace("!", ""), { app: !spec.endsWith("!") }),
  );
  const result = giftFor(
    {
      accounts,
      channelCodes: opts.channels ?? [],
      departmentCode: opts.department ?? null,
    },
    opts.at ?? `${PERIOD}-15`,
  );
  if (!result) throw new Error(`Không có luật cho ngày ${opts.at}`);
  return result;
};

const BH_1N = ["BH-1N-XEMAY", "BH-1N-DIEN"];
const BH_2N = ["BH-COMBO-1N", "BH-2N-XEMAY", "BH-2N-DIEN-100K", "BH-1N-DIEN-200K"];

section("Bậc thang TH1 → TH6 (6 dòng)");
check("TH1 · Combo 2 có VPa", giftOf(["MB", "VPa"]).caseCode, "TH1");
check("TH2 · Combo 2 không VPa", giftOf(["MB", "LPB"]).caseCode, "TH2");
check("TH3 · Combo 3 có cả MSBa và VPa", giftOf(["MB", "VPa", "MSBa"]).caseCode, "TH3");
check("TH4 · Combo 3 chỉ có MSBa", giftOf(["MB", "MSBa", "LPB"]).caseCode, "TH4");
check("TH5 · Combo 3 chỉ có VPa", giftOf(["MB", "VPa", "LPB"]).caseCode, "TH5");
check("TH6 · Combo 3 không có cả hai", giftOf(["LPB", "TPB", "VIB"]).caseCode, "TH6");

section("Số năm bảo hiểm theo từng trường hợp");
check("TH1 · 1 năm", giftOf(["MB", "VPa"]).insuranceYears, 1);
check("TH2 · 1 năm", giftOf(["MB", "LPB"]).insuranceYears, 1);
check("TH3 · 1 năm", giftOf(["MB", "VPa", "MSBa"]).insuranceYears, 1);
check("TH4 · 1 năm", giftOf(["MB", "MSBa", "LPB"]).insuranceYears, 1);
check("TH5 · 2 năm", giftOf(["MB", "VPa", "LPB"]).insuranceYears, 2);
check("TH6 · 2 năm", giftOf(["LPB", "TPB", "VIB"]).insuranceYears, 2);

section("Tiền mặt");
check("TH1 · 20k", giftOf(["MB", "VPa"]).cashTotal, 20_000);
check("TH2 · không tiền", giftOf(["MB", "LPB"]).cashTotal, 0);
check("TH3 · 70k", giftOf(["MB", "VPa", "MSBa"]).cashTotal, 70_000);
check("TH4 · 50k", giftOf(["MB", "MSBa", "LPB"]).cashTotal, 50_000);
check("TH5 · 20k", giftOf(["MB", "VPa", "LPB"]).cashTotal, 20_000);
check("TH6 · không tiền", giftOf(["LPB", "TPB", "VIB"]).cashTotal, 0);
checkCodes(
  "TH3 · 70k chia hai ngân hàng",
  giftOf(["MB", "VPa", "MSBa"]).cash.map((c) => `${c.bankCode}:${c.amount}`),
  ["VPa:20000", "MSBa:50000"],
);
check("VPa chi trong 3 ngày", giftOf(["MB", "VPa"]).cash[0].withinDays, 3);
check("MSBa chi trong 10 ngày", giftOf(["MB", "MSBa", "LPB"]).cash[0].withinDays, 10);

section("Bậc thang KHỚP DÒNG ĐẦU THÌ DỪNG, không cộng dồn");
check("TH3 không lấy thêm 2 năm của TH5", giftOf(["MB", "VPa", "MSBa"]).insuranceYears, 1);
check("TH3 chỉ có đúng hai khoản tiền", giftOf(["MB", "VPa", "MSBa"]).cash.length, 2);
check("TH4 không kèm 20k của VPa", giftOf(["MB", "MSBa", "LPB"]).cashTotal, 50_000);

section("Không đủ combo thì không có quà");
check("không tài khoản nào", giftOf([]).caseCode, null);
check("một tài khoản", giftOf(["MB"]).caseCode, null);
check("một tài khoản · 0 năm bảo hiểm", giftOf(["MB"]).insuranceYears, 0);
check("một tài khoản · rổ rỗng", giftOf(["MB"]).basket.length, 0);
check("MB + MSBa không thành Combo 2", giftOf(["MB", "MSBa"]).caseCode, null);
check("MB + VPb không thành Combo 2", giftOf(["MB", "VPb"]).caseCode, null);
check("vẫn giải thích được vì sao", giftOf(["MB"]).explain.length > 0, true);

section("Điều kiện cài app cũng áp cho quà");
check("VPa chưa cài → tụt xuống TH2", giftOf(["MB", "VPa!", "LPB"]).caseCode, "TH2");
check("VPa chưa cài → mất 20k", giftOf(["MB", "VPa!", "LPB"]).cashTotal, 0);
check("MSBa chưa cài → còn 2 ngân hàng, tụt xuống TH1", giftOf(["MB", "VPa", "MSBa!"]).caseCode, "TH1");
check("MSBa chưa cài → 2 năm tụt còn 1 năm", giftOf(["MB", "VPa", "MSBa!"]).insuranceYears, 1);
check("MSBa chưa cài → mất 50k", giftOf(["MB", "VPa", "MSBa!"]).cashTotal, 20_000);
check("MSBa chưa cài, đủ 3 ngân hàng khác → TH5", giftOf(["MB", "VPa", "LPB", "MSBa!"]).caseCode, "TH5");
check("LPB chưa cài vẫn tính", giftOf(["MB", "VPa", "LPB!"]).caseCode, "TH5");

section("Rổ bảo hiểm");
checkCodes("1 năm · hai gói", giftOf(["MB", "VPa"]).basket.map((b) => b.code), BH_1N);
checkCodes("2 năm · bốn gói", giftOf(["MB", "VPa", "LPB"]).basket.map((b) => b.code), BH_2N);
check(
  "mọi món của mức bảo hiểm đều là gói bảo hiểm",
  giftOf(["MB", "VPa", "LPB"]).basket.every((b) => b.kind === "insurance-package"),
  true,
);

section("Món thêm — CNKD/HKD");
checkCodes(
  "VPa kèm CNKD",
  giftOf(["MB", "VPa", "CNKD"]).basket.map((b) => b.code),
  [...BH_1N, "QUA-LOA", "QUA-MICA"],
);
checkCodes(
  "VPa kèm HKD tính như CNKD",
  giftOf(["MB", "VPa", "HKD"]).basket.map((b) => b.code),
  [...BH_1N, "QUA-LOA", "QUA-MICA"],
);
checkCodes(
  "có CNKD nhưng không có VPa thì không thêm",
  giftOf(["MB", "LPB", "CNKD"]).basket.map((b) => b.code),
  BH_1N,
);
checkCodes(
  "có VPa nhưng không có CNKD thì không thêm",
  giftOf(["MB", "VPa"]).basket.map((b) => b.code),
  BH_1N,
);
check("CNKD không tự thành combo", giftOf(["MB", "CNKD", "HKD"]).caseCode, null);

/**
 * Món thêm của nhóm Phòng Y — chốt lại 2026-08-24.
 *
 * Ba vế của cùng một nhóm: Phòng Y, phòng Dự án, kênh Bệnh viện. Thoả một vế là
 * đủ, và KHÔNG vế nào đòi bậc quà.
 *
 * ⚠️ LẬT chốt 2026-08-22 "phải đạt TH5 hoặc TH6". Thông báo của Kế toán
 * 2026-08-24 mô tả khách CNKD một tài khoản `VPa` được tặng Mì hoặc Nón, mà
 * khách một tài khoản không bao giờ đạt TH5/TH6.
 */
section("Món thêm — Phòng Y, phòng Dự án, kênh Bệnh viện (lưu ý 2)");
checkCodes(
  "TH5 ở Phòng Y",
  giftOf(["MB", "VPa", "LPB"], { department: "PHONG-Y" }).basket.map((b) => b.code),
  [...BH_2N, "QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"],
);
checkCodes(
  "TH6 ở kênh Bệnh viện",
  giftOf(["LPB", "TPB", "VIB"], { channels: ["KENH-BENH-VIEN"] }).basket.map((b) => b.code),
  [...BH_2N, "QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"],
);
checkCodes(
  "TH5 ở phòng Dự án",
  giftOf(["MB", "VPa", "LPB"], { department: "PHONG-DU-AN" }).basket.map((b) => b.code),
  [...BH_2N, "QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"],
);
checkCodes(
  "vừa Phòng Y vừa kênh Bệnh viện thì món không nhân đôi",
  giftOf(["LPB", "TPB", "VIB"], { channels: ["KENH-BENH-VIEN"], department: "PHONG-Y" }).basket.map(
    (b) => b.code,
  ),
  [...BH_2N, "QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"],
);
checkCodes(
  "TH3 ở Phòng Y cũng được quy đổi",
  giftOf(["MB", "VPa", "MSBa"], { department: "PHONG-Y" }).basket.map((b) => b.code),
  [...BH_1N, "QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"],
);
checkCodes(
  "TH1 ở kênh Bệnh viện cũng được quy đổi",
  giftOf(["MB", "VPa"], { channels: ["KENH-BENH-VIEN"] }).basket.map((b) => b.code),
  [...BH_1N, "QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"],
);
checkCodes(
  "TH5 ở phòng khác, kênh khác thì không được quy đổi",
  giftOf(["MB", "VPa", "LPB"], { department: "KD-1", channels: ["KENH-ATM"] }).basket.map(
    (b) => b.code,
  ),
  BH_2N,
);
/**
 * Ca then chốt của lượt chốt lại 2026-08-24: khách MỘT tài khoản ở nhóm Phòng Y
 * vẫn nhận ba món, dù chưa đạt bậc nào. Bản 2026-08-22 trả rổ rỗng ở đây.
 */
checkCodes(
  "khách một tài khoản ở kênh Bệnh viện vẫn nhận món thêm",
  giftOf(["MB"], { channels: ["KENH-BENH-VIEN"] }).basket.map((b) => b.code),
  ["QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"],
);
check(
  "…nhưng vẫn chưa đạt bậc nào, không có gói bảo hiểm",
  giftOf(["MB"], { channels: ["KENH-BENH-VIEN"] }).caseCode,
  null,
);
check(
  "…và 0 năm bảo hiểm",
  giftOf(["MB"], { channels: ["KENH-BENH-VIEN"] }).insuranceYears,
  0,
);
/**
 * Ca của chính thông báo Kế toán 2026-08-24: khách CNKD, duy nhất một app `VPa`,
 * ở Phòng Y. Rổ phải có CẢ Loa/Mica lẫn Mì/Nón, dù không có tổ hợp thắng nào.
 */
checkCodes(
  "CNKD một app VPa ở Phòng Y nhận cả hai nhóm món",
  giftOf(["VPa", "CNKD"], { department: "PHONG-Y" }).basket.map((b) => b.code),
  ["QUA-LOA", "QUA-MICA", "QUA-MI", "QUA-BH-SUC-KHOE", "QUA-NON-BH"],
);
check(
  "…và có cảnh báo hạ mức điểm trong phần giải thích",
  giftOf(["VPa", "CNKD"], { department: "PHONG-Y" }).explain.some((line) =>
    line.includes("xuống mức 0,7"),
  ),
  true,
);

section("Quà tra luật theo NGÀY");
check(
  "trước ngày thể lệ có hiệu lực thì chưa tính được",
  giftFor({ accounts: [], channelCodes: [], departmentCode: null }, "2026-07-31") === null,
  true,
);
check("đúng ngày đầu kỳ đã tính được", giftOf(["MB", "VPa"], { at: "2026-08-01" }).caseCode, "TH1");
check("sang tháng sau vẫn dùng luật này", giftOf(["MB", "VPa"], { at: "2026-09-20" }).caseCode, "TH1");

section("Loại phòng nào có công thức điểm (spec §7.0)");
check("phòng kinh doanh có công thức", kpiAppliesTo("sales"), true);
check("phòng văn phòng chưa có công thức", kpiAppliesTo("office"), false);
check("không thuộc phòng nào thì chưa có công thức", kpiAppliesTo(null), false);

/* ── Kết quả ────────────────────────────────────────────────────────── */

console.log("");
if (failures.length === 0) {
  console.log(`✓ ${passed} ca đạt.\n`);
  process.exit(0);
}

console.log(`✗ ${failures.length} ca HỎNG (${passed} ca đạt):\n`);
for (const failure of failures) console.log(`  · ${failure}\n`);
process.exit(1);
