import { belowTarget, mixPercent, type MixCount, type MixTarget } from "@/lib/api/insuranceBlanks";
import styles from "./InsuranceBlanks.module.scss";

/**
 * Tỉ lệ đơn điện/xe Hoàn thành trong tháng. Dưới mục tiêu thì kèm ký hiệu ⚠ và
 * chữ, không báo chỉ bằng màu (AGENTS.md §8).
 */
export function BlankMix({ mix, target, wordy = false }: { mix: MixCount; target: MixTarget | null; wordy?: boolean }) {
  const percent = mixPercent(mix);
  if (!percent) return <span className="text-muted">Chưa có đơn</span>;
  const warn = belowTarget(mix, target);
  return (
    <span className={warn ? styles.warn : undefined}>
      {percent.electric}/{percent.motorbike}
      {warn &&
        (wordy ? (
          <> - ⚠ Dưới mục tiêu</>
        ) : (
          <>
            {" "}
            <span aria-hidden>⚠</span>
            <span className="sr-only">dưới mục tiêu</span>
          </>
        ))}
    </span>
  );
}
