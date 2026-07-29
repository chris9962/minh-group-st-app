import { X } from "lucide-react";
import styles from "./FilterChips.module.css";

export type FilterChip = {
  /** Nhãn đầy đủ, ví dụ "Đơn vị: Phòng Kinh doanh 2". */
  label: string;
  onRemove: () => void;
};

/**
 * Liệt kê bộ lọc đang bật, mỗi cái một chip bỏ được.
 *
 * Bắt buộc đi kèm `FilterButton`: bộ lọc nằm trong bảng ẩn thì người dùng không
 * biết mình đang lọc, rồi thấy bảng thiếu người và tưởng mất dữ liệu. Chip là
 * chỗ nói ra điều đó, và bỏ lọc ngay tại đây không phải mở lại bảng.
 */
export function FilterChips({ chips }: { chips: FilterChip[] }) {
  if (chips.length === 0) return null;

  return (
    <div className={styles.row}>
      <span className={styles.lead}>Đang lọc</span>
      {chips.map((chip) => (
        <span key={chip.label} className={styles.chip}>
          {chip.label}
          <button
            type="button"
            className={styles.remove}
            onClick={chip.onRemove}
            aria-label={`Bỏ lọc ${chip.label}`}
          >
            <X size={13} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
