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
import { bankingPointsFor, hasRulesFor, type ScoringAccount } from "../src/rules";
import { comboPointsFor } from "../src/rules/2026-08";

const PERIOD = "2026-08";

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: number | boolean, expected: number | boolean): void {
  if (Object.is(actual, expected)) {
    passed += 1;
    return;
  }
  failures.push(`${name}\n      mong ${expected} · nhận ${actual}`);
}

function section(title: string): void {
  console.log(`\n  ${title}`);
}

/** Mặc định: đã cài app, mở giữa tháng 8 — hai thứ đúng với đa số ca. */
const account = (
  customerId: string,
  bankCode: string,
  opts: { app?: boolean; date?: string } = {},
): ScoringAccount => ({
  customerId,
  bankCode,
  appInstalled: opts.app ?? true,
  openedDate: opts.date ?? `${PERIOD}-15`,
});

/** Điểm của cả người, qua đúng cửa vào thật (`src/rules/index.ts`). */
const points = (accounts: ScoringAccount[], yearMonth = PERIOD): number =>
  bankingPointsFor(accounts, yearMonth);

/* ── Mục 2 · bảng điểm — phải đủ cả 10 dòng ─────────────────────────── */

section("Bảng điểm Combo 3 (7 dòng)");
check("03 ưu tiên", comboPointsFor(["MB", "VPa", "MSBa"]), 1.2);
check("02 ưu tiên + 01 khác", comboPointsFor(["MB", "VPa", "LBP"]), 1.0);
check("02 ưu tiên + 01 hạn chế", comboPointsFor(["MB", "VPa", "VPb"]), 0.9);
check("01 ưu tiên + 02 khác", comboPointsFor(["MB", "LBP", "TPB"]), 0.8);
check("01 ưu tiên + 01 khác + 01 hạn chế", comboPointsFor(["MB", "LBP", "VPb"]), 0.7);
check("03 khác", comboPointsFor(["LBP", "TPB", "VIB"]), 0.7);
check("02 khác + 01 hạn chế", comboPointsFor(["LBP", "TPB", "VPb"]), 0.5);

section("Bảng điểm Combo 2 (3 dòng)");
check("02 ưu tiên", comboPointsFor(["MB", "VPa"]), 0.7);
check("01 ưu tiên + 01 khác", comboPointsFor(["MB", "LBP"]), 0.5);
check("02 khác", comboPointsFor(["MSBb", "BIDV"]), 0.4);

section("Thứ tự nhập không đổi điểm");
check("VPa trước MB", comboPointsFor(["VPa", "MB"]), 0.7);
check("hạn chế đứng đầu", comboPointsFor(["VPb", "TPB", "LBP"]), 0.5);
check("khác đứng giữa hai ưu tiên", comboPointsFor(["LBP", "MB", "VPa"]), 1.0);

/* ── Mục 4 lưu ý 1 · Combo 2 không triển khai B4a và B2b ────────────── */

section("Lưu ý 1 — MSBa và VPb không vào Combo 2");
check("MB + MSBa", comboPointsFor(["MB", "MSBa"]), 0);
check("MB + VPb", comboPointsFor(["MB", "VPb"]), 0);
check("LBP + VPb", comboPointsFor(["LBP", "VPb"]), 0);
check("MSBa + VPb", comboPointsFor(["MSBa", "VPb"]), 0);
check("MSBa vẫn vào được Combo 3", comboPointsFor(["MSBa", "LBP", "TPB"]), 0.8);

/* ── Câu 7.3 · mở lẻ thì không có điểm ──────────────────────────────── */

section("Không đủ combo");
check("không tài khoản nào", comboPointsFor([]), 0);
check("một tài khoản ưu tiên", comboPointsFor(["MB"]), 0);
check("một tài khoản khác", comboPointsFor(["LBP"]), 0);

/* ── Câu 7.2 · ngân hàng ngoài thể lệ ───────────────────────────────── */

section("TCB · CNKD · HKD không tham gia chương trình");
check("MB + TCB", comboPointsFor(["MB", "TCB"]), 0);
check("ba mã ngoài thể lệ", comboPointsFor(["TCB", "CNKD", "HKD"]), 0);
check("MB + VPa + TCB rơi về Combo 2", comboPointsFor(["MB", "VPa", "TCB"]), 0.7);
check("mã lạ hoàn toàn", comboPointsFor(["MB", "VPa", "KHONG-CO-THAT"]), 0.7);

/* ── Hai tài khoản cùng một ngân hàng không thành combo ─────────────── */

section("Trùng mã ngân hàng");
check("MB + MB", comboPointsFor(["MB", "MB"]), 0);
check("MB + MB + VPa", comboPointsFor(["MB", "MB", "VPa"]), 0.7);
check("MB + VPa + VPa + LBP", comboPointsFor(["MB", "VPa", "VPa", "LBP"]), 1.0);

/* ── Câu 7.4 · từ 4 tài khoản thì lấy tổ hợp 3 cao điểm nhất ────────── */

section("Dư tài khoản — lấy tổ hợp tốt nhất");
check("MB·VPa·MSBa·VPb", comboPointsFor(["MB", "VPa", "MSBa", "VPb"]), 1.2);
check("MB·VPa·VPb·LBP bỏ VPb", comboPointsFor(["MB", "VPa", "VPb", "LBP"]), 1.0);
check("LBP·TPB·VIB·VPb bỏ VPb", comboPointsFor(["LBP", "TPB", "VIB", "VPb"]), 0.7);
check("năm tài khoản", comboPointsFor(["MB", "VPa", "MSBa", "LBP", "VPb"]), 1.2);
check("trần mỗi khách là 1.2", comboPointsFor(["MB", "VPa", "MSBa", "LBP", "TPB", "VIB"]), 1.2);

/* ── Câu 7.8 · chỉ VPa và MSBa mới đòi cài app ──────────────────────── */

section("Điều kiện cài app");
check(
  "VPa chưa cài → rớt khỏi combo",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa", { app: false }),
    account("kh1", "LBP"),
  ]),
  0.5,
);
check(
  "VPa đã cài → tính đủ",
  points([account("kh1", "MB"), account("kh1", "VPa"), account("kh1", "LBP")]),
  1.0,
);
check(
  "MSBa chưa cài → rớt khỏi combo",
  points([
    account("kh1", "MB"),
    account("kh1", "MSBa", { app: false }),
    account("kh1", "LBP"),
  ]),
  0.5,
);
check(
  "LBP chưa cài vẫn tính",
  points([
    account("kh1", "MB"),
    account("kh1", "LBP", { app: false }),
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
  "cả hai bank đòi app đều chưa cài",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa", { app: false }),
    account("kh1", "MSBa", { app: false }),
  ]),
  0,
);

/* ── Câu 7.11 · gom theo khách, không gom theo người ─────────────────── */

section("Gom theo khách");
check(
  "hai khách cộng lại",
  points([
    account("kh1", "MB"),
    account("kh1", "VPa"),
    account("kh1", "MSBa"),
    account("kh2", "LBP"),
    account("kh2", "TPB"),
  ]),
  1.6,
);
check(
  "mỗi khách một tài khoản thì không ai có combo",
  points([account("kh1", "MB"), account("kh2", "VPa"), account("kh3", "LBP")]),
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
    account("kh1", "LBP"),
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
    account("kh2", "LBP"),
    account("kh3", "MSBb"),
    account("kh3", "BIDV"),
  ]),
  1.6,
);

/* ── Kết quả ────────────────────────────────────────────────────────── */

console.log("");
if (failures.length === 0) {
  console.log(`✓ ${passed} ca đạt.\n`);
  process.exit(0);
}

console.log(`✗ ${failures.length} ca HỎNG (${passed} ca đạt):\n`);
for (const failure of failures) console.log(`  · ${failure}\n`);
process.exit(1);
