"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  BarChart as RechartsBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartColors } from "@/lib/chart-colors";
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

const AXIS_TICK = {
  fontSize: 10.5,
  fill: "var(--om-text-3)",
  fontFamily: "var(--font-body)",
};

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
  title,
  caption,
  height = 190,
  highlight,
  showLegend = true,
}: Props) {
  const chartColors = useChartColors();

  return (
    <div className={styles.wrap}>
      {title && <strong className={styles.title}>{title}</strong>}

      <div className={styles.chart} aria-hidden>
        <ResponsiveContainer width="100%" height={height}>
          <RechartsBarChart
            data={rows}
            margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
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
              width={44}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--om-sidebar-hover)" }}
              contentStyle={{
                background: "var(--om-bg)",
                border: "1px solid var(--om-line)",
                borderRadius: 14,
                fontSize: 12.5,
                fontFamily: "var(--font-body)",
                boxShadow: "var(--shadow-md)",
              }}
              labelStyle={{ fontWeight: 600, marginBottom: 4 }}
            />
            {showLegend && (
              <Legend
                verticalAlign="top"
                align="right"
                height={26}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11.5, fontFamily: "var(--font-body)" }}
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
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>

      <table className="an-nhin">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Mốc</th>
            {series.map((s) => (
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
              {series.map((s) => (
                <td key={s.key}>{row[s.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
