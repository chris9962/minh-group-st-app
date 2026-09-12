import { clsx } from "clsx";
import { KpiHighlight } from "@/components/ui/KpiHighlight";
import { StatStack, type StatStackItem } from "@/components/ui/StatStack";
import type { BankingSummary } from "@/lib/api/dashboard";
import { sourceColor } from "@/lib/chart-colors";
import { formatCount } from "@/lib/format";
import styles from "./BankingHeadline.module.scss";

/* Số phía trên là số KHÁCH; nhãn là số tài khoản hoàn thành của khách đó. */
const CUSTOMERS_BY_ACCOUNTS_LABEL = ["0 tài khoản", "1 tài khoản", "2 tài khoản", "3 tài khoản"] as const;

/**
 * Hàng số ngân hàng đầu trang: tỉ lệ cài app, tài khoản mở, khách hàng chia
 * theo số tài khoản hoàn thành, app đã cài. Tổng quan P-80 và chi tiết phòng ban P-91 cùng dùng,
 * đọc cùng một `BankingSummary` nên hai màn không bao giờ lệch số.
 *
 * `delta` chỉ Tổng quan có: kỳ liền trước để so. `appsCompanion` là ô thứ hai
 * của thẻ app (Tổng quan đặt "chưa phát thưởng"). `children` là thẻ thêm ở
 * cuối hàng (Tổng quan đặt ô điểm tổng), có thì hàng nở thành bốn cột.
 */
export function BankingHeadline({
  summary,
  periodLabel,
  delta,
  appsCompanion,
  children,
}: {
  summary: BankingSummary;
  periodLabel: string;
  delta?: { text: string; up: boolean };
  appsCompanion?: StatStackItem;
  children?: React.ReactNode;
}) {
  return (
    <div className={clsx(styles.headline, children && styles.headlineWide)}>
      <KpiHighlight
        ariaLabel="Tỉ lệ cài app trên số tài khoản mở"
        percent={summary.installPercent}
        description={
          <>
            tỉ lệ cài app trên
            <br />
            số tài khoản mở
          </>
        }
        detail={`${formatCount(summary.appsInstalled)} app / ${formatCount(summary.accountsOpened)} tài khoản mở ${periodLabel}`}
        delta={delta}
        rows={summary.installRateByBank.map((b, i) => ({
          label: b.code,
          percent: b.percent,
          detail: `${formatCount(b.appsInstalled)} / ${formatCount(b.accountsOpened)}`,
          color: sourceColor(b.code, i),
        }))}
      />

      <StatStack
        items={[
          { value: formatCount(summary.accountsOpened), label: "tài khoản mở" },
          {
            // Số lớn là khách CÓ tài khoản; tổng hồ sơ suy ra từ bốn ô dưới, ô
            // "0 tài khoản" là số hồ sơ chưa mở được tài khoản nào.
            value: formatCount(summary.customersWithAccounts),
            label: `khách có tài khoản ${periodLabel}`,
            breakdown: summary.customersByAccounts.map((count, i) => ({
              value: formatCount(count),
              label: CUSTOMERS_BY_ACCOUNTS_LABEL[i],
            })),
          },
        ]}
      />

      <StatStack
        items={[
          { value: formatCount(summary.appsInstalled), label: "app đã cài" },
          ...(appsCompanion ? [appsCompanion] : []),
        ]}
      />

      {children}
    </div>
  );
}
