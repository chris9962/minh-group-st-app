import { ProgressRing } from "@/components/ui/ProgressRing";
import { sourceColor } from "@/lib/chart-colors";
import { formatPoints } from "@/lib/format";
import styles from "./KpiScoreBlock.module.scss";

type Source = { label: string; points: number; detail: string };

type Props = {
  /** Các nguồn điểm, theo đúng thứ tự máy chủ trả — màu suy từ vị trí. */
  sources: Source[];
  /** Chỉ tiêu của kỳ, dùng làm mốc đầy vòng. */
  target: number;
  ariaLabel: string;
  /**
   * Hai con số đứng cạnh vòng. Mỗi màn hiện một cặp khác nhau nên để nơi gọi
   * tự truyền: P-52 hiện "còn thiếu" với "còn lại N ngày", màn Tổng quan hiện
   * "chỉ tiêu" với "còn thiếu" vì số ngày đã nằm ở tiêu đề thẻ.
   */
  facts: React.ReactNode;
};

/**
 * Vòng điểm KPI kèm chú giải nguồn điểm.
 *
 * Dùng ở hai chỗ: khối KPI của hồ sơ nhân viên (P-52) và màn Tổng quan của
 * nhân viên. Hai chỗ đó vốn chép nhau cả JSX lẫn khoảng 70 dòng CSS, và đã lệch
 * hai giá trị — `gap` của khối vòng, `margin` của chú giải (AGENTS.md §2).
 */
export function KpiScoreBlock({ sources, target, ariaLabel, facts }: Props) {
  return (
    <>
      <div className={styles.score}>
        <ProgressRing
          segments={sources.map((s, i) => ({
            label: s.label,
            value: s.points,
            color: sourceColor(s.label, i),
          }))}
          max={target}
          ariaLabel={ariaLabel}
        />
        <dl className={styles.scoreFacts}>{facts}</dl>
      </div>

      <dl className={styles.legend}>
        {sources.map((s, i) => (
          <div key={s.label}>
            <dt>
              <span
                className={styles.dot}
                style={{ background: sourceColor(s.label, i) }}
                aria-hidden
              />
              {s.label}
              <span className={styles.legendDetail}>{s.detail}</span>
            </dt>
            <dd className="tabular-nums">{formatPoints(s.points)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
