import { Check, Clock, Minus, TriangleAlert } from "lucide-react";
import {
  PHOTO_CHECK_LABEL,
  type PhotoCheck,
  type PhotoCheckKey,
  type PhotoCheckVerdict,
} from "@/lib/api/photoCheck";
import styles from "./PhotoCheckMarks.module.scss";

const ORDER: PhotoCheckKey[] = ["open", "home", "transfer"];

const VERDICT_TEXT: Record<PhotoCheckVerdict, string> = {
  pass: "đạt",
  fail: "không đạt",
  missing: "thiếu ảnh",
};

const VERDICT_MARK: Record<PhotoCheckVerdict, React.ReactNode> = {
  pass: <Check size={12} strokeWidth={3} />,
  fail: <TriangleAlert size={11} />,
  missing: <Minus size={12} strokeWidth={3} />,
};

/**
 * Ba ký hiệu cho cột "Xác thực" của bảng, thứ tự cố định mở tài khoản, màn hình
 * chính, chuyển khoản. Người duyệt học vị trí một lần rồi nhìn cột là biết.
 *
 * Ký hiệu là kênh chính, màu chỉ hỗ trợ (AGENTS.md §8). `aria-label` đọc trọn
 * ba kết quả cho trình đọc màn hình.
 */
export function PhotoCheckMarks({ check }: { check: PhotoCheck | null }) {
  if (!check) return <span className="text-muted">—</span>;

  if (check.status === "pending")
    return (
      <span className={`${styles.marks} ${styles.pending}`} aria-label="Đang xác thực ảnh">
        <Clock size={12} aria-hidden />
      </span>
    );

  if (check.status === "failed")
    return (
      <span className={`${styles.marks} ${styles.failed}`} aria-label={`Xác thực ảnh hỏng: ${check.error}`}>
        <TriangleAlert size={11} aria-hidden />
      </span>
    );

  const byKey = new Map(check.items.map((i) => [i.key, i.verdict]));
  const label = ORDER.map(
    (k) => `${PHOTO_CHECK_LABEL[k]} ${VERDICT_TEXT[byKey.get(k) ?? "missing"]}`,
  ).join(", ");

  return (
    <span className={styles.marks} aria-label={label}>
      {ORDER.map((k) => {
        const verdict = byKey.get(k) ?? "missing";
        return (
          <span key={k} className={`${styles.mark} ${styles[verdict]}`} aria-hidden>
            {VERDICT_MARK[verdict]}
          </span>
        );
      })}
    </span>
  );
}
