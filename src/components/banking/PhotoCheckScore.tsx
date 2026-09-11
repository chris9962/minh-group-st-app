import { StatusTag, type StatusTone } from "@/components/ui/StatusTag";
import type { PhotoCheck } from "@/lib/api/photoCheck";

/**
 * Điểm xác thực ảnh cho cột của bảng: `2/3` = 2 phép kiểm đạt trên 3.
 *
 * Con số chứ không phải từng ký hiệu: ngân hàng khác có thể có 6 phép kiểm,
 * cột không nở theo. Màu theo tỉ lệ đạt, càng thấp càng mạnh: đạt hết xanh,
 * từ nửa trở lên cam viền, dưới nửa đỏ. Ký hiệu của `StatusTag` đi kèm nên
 * không chỉ dựa vào màu (AGENTS.md §8).
 */
export function PhotoCheckScore({ check }: { check: PhotoCheck | null }) {
  if (!check) return <span className="text-muted">—</span>;
  if (check.status === "pending") return <StatusTag tone="waiting">Đang phân tích</StatusTag>;
  if (check.status === "failed") return <StatusTag tone="warn">Hỏng</StatusTag>;

  const tone: StatusTone =
    check.total > 0 && check.passed === check.total
      ? "ok"
      : check.passed * 2 >= check.total
        ? "warn"
        : "cancelled";
  return (
    <StatusTag tone={tone}>
      <span className="tabular-nums">
        {check.passed}/{check.total}
      </span>
    </StatusTag>
  );
}
