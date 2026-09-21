/**
 * Ca thử kỳ số liệu: hôm nay · tháng này · 3 tháng · 6 tháng · 1 năm.
 *
 * Cửa sổ nhiều tháng là tháng lịch trọn, kể cả tháng đang chạy — cùng cách
 * "Tháng này" lấy hết 1–31 dù hôm nay mới 18. Kỳ trước là đúng bằng số tháng
 * liền trước, để bảng xếp hạng còn so được tăng giảm.
 */
import {
  formatPeriodChip,
  periodKindLabel,
  periodRanges,
  previousPeriodLabel,
  toPersonPeriod,
} from "../src/lib/period";

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

const TODAY = "2026-09-18";

const three = periodRanges("last-3-months", TODAY);
check("3 tháng: từ đầu tháng thứ 3", three.current.from, "2026-07-01");
check("3 tháng: đến cuối tháng này", three.current.to, "2026-09-30");
check("3 tháng trước: đầu", three.previous?.from ?? null, "2026-04-01");
check("3 tháng trước: cuối", three.previous?.to ?? null, "2026-06-30");

const six = periodRanges("last-6-months", TODAY);
check("6 tháng: từ đầu tháng thứ 6", six.current.from, "2026-04-01");
check("6 tháng: đến cuối tháng này", six.current.to, "2026-09-30");
check("6 tháng trước: đầu", six.previous?.from ?? null, "2025-10-01");
check("6 tháng trước: cuối", six.previous?.to ?? null, "2026-03-31");

const year = periodRanges("last-1-year", TODAY);
check("1 năm: từ đầu tháng thứ 12", year.current.from, "2025-10-01");
check("1 năm: đến cuối tháng này", year.current.to, "2026-09-30");
check("năm trước: đầu", year.previous?.from ?? null, "2024-10-01");
check("năm trước: cuối", year.previous?.to ?? null, "2025-09-30");

const month = periodRanges("this-month", TODAY);
check("tháng này: đầu", month.current.from, "2026-09-01");
check("tháng này: cuối", month.current.to, "2026-09-30");
check("tháng trước: đầu", month.previous?.from ?? null, "2026-08-01");
check("tháng trước: cuối", month.previous?.to ?? null, "2026-08-31");

const day = periodRanges("today", TODAY);
check("hôm nay: chính ngày đó", day.current.from, TODAY);
check("hôm nay: một ngày", day.current.to, TODAY);
check("hôm qua", day.previous?.from ?? null, "2026-09-17");

const picked = periodRanges("range:2026-07-05:2026-07-12", TODAY);
check("khoảng tự chọn không có kỳ trước", picked.previous === null, true);
check("khoảng tự chọn giữ ngày gửi", picked.current.from, "2026-07-05");

const jan = periodRanges("last-3-months", "2026-01-15");
check("3 tháng xuyên năm: đầu", jan.current.from, "2025-11-01");
check("3 tháng xuyên năm: cuối", jan.current.to, "2026-01-31");
check("3 tháng trước xuyên năm: đầu", jan.previous?.from ?? null, "2025-08-01");
check("3 tháng trước xuyên năm: cuối", jan.previous?.to ?? null, "2025-10-31");

const leap = periodRanges("last-3-months", "2024-02-29");
check("tháng nhuận: cuối cửa sổ là 29/02", leap.current.to, "2024-02-29");
check("tháng nhuận: đầu cửa sổ", leap.current.from, "2023-12-01");

check("nhãn 3 tháng", periodKindLabel("last-3-months"), "3 tháng");
check("nhãn 6 tháng", periodKindLabel("last-6-months"), "6 tháng");
check("nhãn 1 năm", periodKindLabel("last-1-year"), "1 năm");
check("nhãn hôm nay", periodKindLabel("today"), "Hôm nay");
check("nhãn tháng này", periodKindLabel("this-month"), "Tháng này");
check("nhãn khoảng ngày", periodKindLabel("range"), "Khoảng ngày");

check("so với 3 tháng trước", previousPeriodLabel("last-3-months"), "3 tháng trước");
check("so với 6 tháng trước", previousPeriodLabel("last-6-months"), "6 tháng trước");
check("so với năm trước", previousPeriodLabel("last-1-year"), "năm trước");
check("so với hôm qua", previousPeriodLabel("today"), "hôm qua");
check("so với tháng trước", previousPeriodLabel("this-month"), "tháng trước");
check("khoảng tự chọn không so", previousPeriodLabel("range"), null);

check(
  "hồ sơ nhân viên: 3 tháng thành range",
  toPersonPeriod("last-3-months", TODAY),
  "range:2026-07-01:2026-09-30",
);
check("hồ sơ nhân viên: tháng này thành YYYY-MM", toPersonPeriod("this-month", TODAY), "2026-09");
check("hồ sơ nhân viên: hôm nay giữ today", toPersonPeriod("today", TODAY), "today");

check(
  "chip cùng năm: viết tắt tháng",
  formatPeriodChip("2026-07-01", "2026-09-30"),
  "01 thg 7 - 30 thg 9, 2026",
);
check("chip một ngày", formatPeriodChip("2026-09-18", "2026-09-18"), "18 thg 9, 2026");
check(
  "chip khác năm: ghi cả hai năm",
  formatPeriodChip("2025-10-01", "2026-09-30"),
  "01 thg 10, 2025 - 30 thg 9, 2026",
);

if (failures.length > 0) {
  console.error(`\n${failures.length} ca sai:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log(`\n  ${passed} ca đạt\n`);
