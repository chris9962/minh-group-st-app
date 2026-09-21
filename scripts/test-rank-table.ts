/**
 * Ca thử cho số hạng trên bảng xếp hạng dashboard.
 *
 * Bảng danh sách (khách, bảo hiểm…) không đánh số. Chỉ khi `highlightTop` có
 * mặt thì dòng mới mang hạng, và ba dòng đầu mới được tô.
 */
import {
  daysEndingOn,
  growthPercent,
  rankingDelta,
  rankingDeltaLabel,
  rankingDeltaText,
  rankingHighlight,
  rankingLabel,
  rankingPlace,
  rankingPlacesByValue,
  rankingShare,
  rankingShareTitle,
  rankingTip,
  sparklineHeights,
} from "../src/components/ui/ranking";

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

check("dòng đầu trang là hạng 1", rankingPlace(0), 1);
check("dòng thứ ba là hạng 3", rankingPlace(2), 3);
check("trang sau cộng offset", rankingPlace(0, 1, 15), 16);
check("không highlight khi tắt xếp hạng", rankingHighlight(1, undefined), false);
check("hạng 1 nằm trong top 3", rankingHighlight(1, 3), true);
check("hạng 3 nằm trong top 3", rankingHighlight(3, 3), true);
check("hạng 4 không tô nền", rankingHighlight(4, 3), false);
check("nhãn đọc lên có chữ Hạng", rankingLabel(1), "Hạng 1");
check("hạng 3 kỳ trước, hạng 1 kỳ này là lên 2", rankingDelta(1, 3), 2);
check("hạng 1 kỳ trước, hạng 3 kỳ này là xuống 2", rankingDelta(3, 1), -2);
check("đứng yên là 0", rankingDelta(2, 2), 0);
check("không có kỳ trước thì không so", rankingDelta(1, null), null);
check(
  "sắp giảm dần: số lớn nhất hạng 1",
  JSON.stringify(rankingPlacesByValue([10, 30, 20], true)),
  JSON.stringify([3, 1, 2]),
);
check(
  "giá trị null không có hạng kỳ trước",
  JSON.stringify(rankingPlacesByValue([10, null, 20], true)),
  JSON.stringify([2, null, 1]),
);
check("nhãn lên hạng", rankingDeltaLabel(2), "Lên 2 hạng");
check("nhãn xuống hạng", rankingDeltaLabel(-1), "Xuống 1 hạng");
check("nhãn đứng yên", rankingDeltaLabel(0), "Không đổi hạng");
check("nhãn không so được", rankingDeltaLabel(null), null);
check("lên 1 bậc ghi +1", rankingDeltaText(1), "+1");
check("xuống 1 bậc ghi −1", rankingDeltaText(-1), "−1");
check("đứng yên không ghi số", rankingDeltaText(0), null);
check("không so được thì không ghi", rankingDeltaText(null), null);
check("phần của tổng: 21 trên 37", rankingShare(21, 37), Math.round((21 / 37) * 100));
check("tổng 0 thì thanh 0", rankingShare(5, 0), 0);
check(
  "hover thanh tỉ lệ đọc số trên tổng",
  rankingShareTitle(21, 37, "tài khoản mở"),
  "21 trên 37 tài khoản mở · 57%",
);
check("hover khi chưa có tổng thì chỉ đọc số", rankingShareTitle(5, 0, "điểm"), "5 điểm");
check(
  "hover ghép hạng với tên",
  rankingTip("Hạng 1", "Lên 2 hạng", "Phòng Kinh doanh 1"),
  "Hạng 1 · Lên 2 hạng · Phòng Kinh doanh 1",
);
check("hover bỏ phần trống", rankingTip("Hạng 4", null, "Phòng Dự Án"), "Hạng 4 · Phòng Dự Án");
check("hover không có gì thì im", rankingTip(null, undefined, ""), null);
check("tăng trưởng 50% khi gấp rưỡi", growthPercent(15, 10), 50);
check("tăng trưởng giảm 50%", growthPercent(5, 10), -50);
check("kỳ trước 0 và kỳ này 0 là đứng yên", growthPercent(0, 0), 0);
check("kỳ trước 0 thì không ra phần trăm", growthPercent(5, 0), null);
check("không có kỳ trước thì không so tăng trưởng", growthPercent(5, null), null);
check(
  "7 ngày kết thúc đúng ngày chốt",
  JSON.stringify(daysEndingOn("2026-09-18", 7)),
  JSON.stringify([
    "2026-09-12",
    "2026-09-13",
    "2026-09-14",
    "2026-09-15",
    "2026-09-16",
    "2026-09-17",
    "2026-09-18",
  ]),
);
check(
  "cột sparkline chuẩn theo max của chính dòng",
  JSON.stringify(sparklineHeights([0, 2, 4])),
  JSON.stringify([0, 50, 100]),
);
check(
  "mọi ngày 0 thì cột cao 0",
  JSON.stringify(sparklineHeights([0, 0, 0])),
  JSON.stringify([0, 0, 0]),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} ca sai:\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log(`\n  ${passed} ca đạt\n`);
