"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useChartColors } from "@/lib/chart-colors";
import { formatPoints } from "@/lib/format";
import styles from "./BarChart.module.css";

export type BarSeries = {
  /** Khoá của chuỗi trong từng dòng dữ liệu. */
  key: string;
  label: string;
  color: string;
};

type Props = {
  rows: Record<string, string | number>[];
  /** Khoá của cột nhãn trục ngang. */
  labelKey: string;
  series: BarSeries[];
  /** Chuỗi vẽ thành đường đè lên cột, cùng trục dọc với cột. */
  lines?: BarSeries[];
  title?: string;
  /** Mô tả cho trình đọc màn hình, đặt ở caption của bảng số ẩn. */
  caption: string;
  height?: number;
  /**
   * Giá trị nhãn của cột cần làm nổi; các cột còn lại chuyển sang màu mờ.
   * Chỉ dùng được khi biểu đồ có ĐÚNG một chuỗi.
   */
  highlight?: string;
  /** Một chuỗi thì chú thích chỉ chiếm chỗ chứ không nói thêm gì. */
  showLegend?: boolean;
};

const valueText = (value: string | number) =>
  typeof value === "number" ? formatPoints(value) : value;

const AXIS_TICK = {
  fontSize: 10.5,
  fill: "var(--om-text-3)",
  fontFamily: "var(--font-body)",
};

/**
 * Tooltip tự dựng để mỗi dòng có chấm màu như chú thích. Nội dung mặc định của
 * recharts chỉ báo màu bằng màu chữ, mà chữ chuỗi màu nhạt không đọc được.
 */
function ChartTooltip({
  active,
  payload,
  label,
  columns,
}: TooltipContentProps & { columns: BarSeries[] }) {
  if (!active || payload.length === 0) return null;
  return (
    <div className={styles.tooltip}>
      <strong className={styles.tooltipLabel}>{label}</strong>
      <ul className={styles.tooltipList}>
        {payload.map((entry) => {
          const column = columns.find((c) => c.key === entry.dataKey);
          return (
            <li key={String(entry.dataKey)} className={styles.tooltipRow}>
              <span
                className={styles.tooltipDot}
                style={{ background: column?.color ?? entry.color }}
                aria-hidden
              />
              <span className={styles.tooltipName}>{entry.name}</span>
              <span className={styles.tooltipValue}>
                {valueText(entry.value as number | string)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Biểu đồ cột chồng.
 *
 * Dùng recharts vì số cột đổi theo kỳ — một ngày là 6 cột, một tháng là 30.
 * Tự vẽ bằng div thì phải tự lo trục dọc, giãn nhãn, đường lưới, rê chuột;
 * tới 30 cột là nhìn so le ngay.
 *
 * Recharts không lo phần đọc màn hình, nên vẫn giữ bảng số ẩn bên dưới.
 */
export function BarChart({
  rows,
  labelKey,
  series,
  lines = [],
  title,
  caption,
  height = 190,
  highlight,
  showLegend = true,
}: Props) {
  const chartColors = useChartColors();
  const columns = [...series, ...lines];

  return (
    <div className={styles.wrap}>
      {title && <strong className={styles.title}>{title}</strong>}

      <div className={styles.chart} aria-hidden>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={rows}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="18%"
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--om-line)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey={labelKey}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--om-line)" }}
              interval="preserveStartEnd"
              minTickGap={14}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              // Bề ngang theo số dài nhất: cột khách hàng lên tới hàng nghìn,
              // bề ngang cố định cho số hai chữ số thì cắt mất đầu số.
              width="auto"
              allowDecimals={false}
              tickFormatter={(value: number) => formatPoints(value)}
            />
            <Tooltip
              cursor={{ fill: "var(--om-sidebar-hover)" }}
              content={(props) => <ChartTooltip {...props} columns={columns} />}
            />
            {showLegend && (
              <Legend
                verticalAlign="top"
                align="right"
                height={26}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11.5, fontFamily: "var(--font-body)" }}
                // Recharts tô chữ chú thích bằng chính màu chuỗi. Chấm màu là đủ
                // để nối với cột; chữ tô màu theo thì mỗi nhãn một màu, đọc mệt
                // và nhãn màu nhạt gần như mất hút trên nền thẻ.
                formatter={(value) => (
                  <span style={{ color: "var(--om-text-2)" }}>{value}</span>
                )}
              />
            )}
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="stack"
                fill={s.color}
                // Không bo góc: cột chồng mà bo đầu từng khúc thì giữa hai
                // khúc hở ra một khe lõm.
                isAnimationActive={false}
              >
                {/* Cell phải là con của Bar — đây là cách duy nhất recharts cho
                    đổi màu từng cột. Không có highlight thì Bar tự tô fill. */}
                {highlight !== undefined &&
                  rows.map((row) => (
                    <Cell
                      key={String(row[labelKey])}
                      fill={
                        String(row[labelKey]) === highlight
                          ? s.color
                          : chartColors.muted
                      }
                    />
                  ))}
              </Bar>
            ))}
            {lines.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* `sr-only` đặt ở div bọc: thẻ table bỏ qua `width: 1px` và `overflow`, nên giãn theo nội dung và làm trang mobile tràn ngang. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Mốc</th>
              {columns.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row[labelKey])}>
                <th scope="row">{String(row[labelKey])}</th>
                {columns.map((s) => (
                  <td key={s.key}>{valueText(row[s.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
