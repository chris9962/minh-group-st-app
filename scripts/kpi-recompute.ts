/**
 * Tính lại điểm KPI của MỘT tháng cho toàn công ty — `bun run kpi:recompute [YYYY-MM]`.
 *
 * Vì sao cần chạy tay: `kpi_scores` là bảng LƯU SẴN, chỉ được cập nhật khi có
 * người ghi dữ liệu tính điểm. Đổi công thức không đụng tới dòng cũ, nên mọi
 * dòng ghi trước 07/08 vẫn mang điểm của công thức bỏ đi từ 03/08 (và cột ngân
 * hàng thì luôn bằng 0). Chạy lệnh này một lần cho từng tháng đã có dữ liệu.
 *
 * Chạy lại nhiều lần vô hại: hàm ghi đè theo `(user_id, year_month)`.
 */
import { businessMonth } from "../src/lib/format";
import { recomputeKpiForMonth } from "../src/server/kpi";
import { hasRulesFor } from "../src/rules";

async function main() {
  const yearMonth = process.argv[2] ?? businessMonth();
  if (!/^\d{4}-\d{2}$/.test(yearMonth))
    throw new Error(`Tháng phải có dạng YYYY-MM, nhận "${yearMonth}"`);

  // Không có file luật thì điểm ngân hàng ra 0 hết. Chạy tiếp sẽ GHI ĐÈ số cũ
  // bằng 0 và không cách nào lấy lại, nên dừng ở đây và nói rõ vì sao.
  if (!hasRulesFor(yearMonth))
    throw new Error(
      `Chưa có file luật cho kỳ ${yearMonth} (src/rules/) — chạy tiếp sẽ ghi đè điểm ngân hàng thành 0.`,
    );

  const count = await recomputeKpiForMonth(yearMonth);
  console.log(`Tính lại xong ${count} nhân viên cho tháng ${yearMonth}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
