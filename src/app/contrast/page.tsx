"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StatusTag } from "@/components/ui/StatusTag";
import { TextField } from "@/components/ui/TextField";
import { useTheme } from "@/store/theme";
import { contrast, effectiveBackground, parseColor, thresholdOf, toHex } from "./contrast";
import styles from "./page.module.css";

/**
 * Thước đo tương phản màu — mở khi sửa bộ màu, KHÔNG phải màn nghiệp vụ.
 *
 * Nằm ngoài nhóm route `(app)` có chủ đích: `AppShell` chỉ mở những đường dẫn
 * suy ra được từ thanh điều hướng, mà trang này không có mục trên đó nên đặt
 * trong `(app)` là bị đẩy về Tổng quan ngay. Trang không đọc dữ liệu nào.
 *
 * Mỗi dòng vẽ THÀNH PHẦN THẬT rồi đo lại trên chính nó. Không màu nào gõ tay
 * trong file này, nên đổi token ở `../mgst-design/_ds` là con số ở đây đổi
 * theo — đó là cách kiểm lại một bản sửa màu.
 */

type Sample = {
  id: string;
  label: string;
  /** Nền trang thay vì nền thẻ — hộp thoại đặt ô nhập lên `--om-bg`. */
  onPageBg?: boolean;
  render: () => React.ReactNode;
  /** Lấy đúng phần tử mang CHỮ cần đo, không phải khung ngoài. */
  pick: (root: HTMLElement) => Element | null;
};

const self = (root: HTMLElement) => root.firstElementChild;

const SAMPLES: Sample[] = [
  {
    id: "btn-primary",
    label: "Nút chính — .btn-primary",
    render: () => <Button>Lưu thay đổi</Button>,
    pick: self,
  },
  {
    id: "tab-count",
    label: "Chip đếm trên tab đang chọn — SegmentedTabs .active .count",
    render: () => <TabsSample />,
    pick: (root) => root.querySelector("label:has(input:checked) span"),
  },
  {
    id: "table-th",
    label: "Tiêu đề cột — .table th (chạy ở mọi bảng qua RankTable)",
    render: () => (
      <table className="table">
        <thead>
          <tr>
            <th>Ngày tạo đơn</th>
            <th>Mã đơn</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2026-08-17</td>
            <td>BH-000123</td>
          </tr>
        </tbody>
      </table>
    ),
    pick: (root) => root.querySelector("th"),
  },
  {
    id: "field-hint",
    label: "Chú thích dưới ô nhập — TextField hint, trong hộp thoại",
    onPageBg: true,
    render: () => <TextField label="Số điện thoại" hint="Đủ 10 số, không có dấu cách" />,
    pick: (root) => root.querySelector('[class*="hint"]'),
  },
  {
    id: "text-2",
    label: "Chữ phụ trên thẻ — --om-text-2",
    render: () => <span style={{ color: "var(--om-text-2)" }}>Chưa có đơn nào trong kỳ này</span>,
    pick: self,
  },
  {
    id: "text-3",
    label: "Chữ mờ nhất trên thẻ — --om-text-3",
    render: () => <span style={{ color: "var(--om-text-3)" }}>Cập nhật 5 phút trước</span>,
    pick: self,
  },
  {
    id: "link",
    label: "Chữ bấm được — --om-link",
    render: () => <a href="#link">Nguyễn Văn A</a>,
    pick: self,
  },
  {
    id: "tag-ok",
    label: "Nhãn trạng thái — tone ok",
    render: () => <StatusTag tone="ok">Hoàn thành</StatusTag>,
    pick: self,
  },
  {
    id: "tag-warn",
    label: "Nhãn trạng thái — tone warn",
    render: () => <StatusTag tone="warn">Chưa đạt</StatusTag>,
    pick: self,
  },
  {
    id: "tag-progress",
    label: "Nhãn trạng thái — tone progress",
    render: () => <StatusTag tone="progress">Đang tạo</StatusTag>,
    pick: self,
  },
  {
    id: "tag-review",
    label: "Nhãn trạng thái — tone review",
    render: () => <StatusTag tone="review">Chờ duyệt</StatusTag>,
    pick: self,
  },
  {
    id: "tag-waiting",
    label: "Nhãn trạng thái — tone waiting (dùng --om-text-3)",
    render: () => <StatusTag tone="waiting">Chờ làm tay</StatusTag>,
    pick: self,
  },
];

/**
 * Cặp biến đo thẳng, không qua DOM — dành cho trạng thái chỉ hiện lúc di chuột.
 * Không giữ được `:hover` để đo lại, mà đó lại là cặp màu tệ nhất của nút.
 */
const TOKEN_PAIRS = [
  { id: "hover", label: "Nút chính khi di chuột", fg: "--om-text-on-accent", bg: "--om-orange-mid" },
  { id: "active", label: "Nút chính khi nhấn giữ", fg: "--om-text-on-accent", bg: "--om-orange-ink" },
  { id: "warn-soft", label: "Chữ trên nền cảnh báo", fg: "--om-orange-ink", bg: "--om-orange-soft" },
  { id: "ok-soft", label: "Chữ trên nền nhãn đạt", fg: "--om-green-ink", bg: "--om-green-soft" },
] as const;

function TabsSample() {
  const [tab, setTab] = useState("customers");
  return (
    <SegmentedTabs
      label="Ví dụ tab"
      value={tab}
      onChange={setTab}
      options={[
        { value: "customers", label: "Khách hàng", count: 3 },
        { value: "accounts", label: "Tài khoản", count: 9 },
      ]}
    />
  );
}

type Result = { ratio: number; need: number; fg: string; bg: string };

export default function ContrastPage() {
  const { theme, toggle } = useTheme();
  const [results, setResults] = useState<Record<string, Result>>({});
  const hosts = useRef(new Map<string, HTMLElement>());

  /**
   * Đo được CHỈ SAU khi trình duyệt vẽ xong — `getComputedStyle` là hệ thống
   * bên ngoài React, đúng chỗ dùng effect (AGENTS.md §7). Đo lại khi đổi bộ
   * màu vì cùng một dòng CSS cho hai kết quả khác nhau.
   */
  useEffect(() => {
    const measured: Record<string, Result> = {};

    for (const [key, host] of hosts.current) {
      const sample = SAMPLES.find((s) => s.id === key);
      const el = sample ? sample.pick(host) : host.firstElementChild;
      if (!el) continue;

      const fg = parseColor(getComputedStyle(el).color);
      const bg = effectiveBackground(el);
      measured[key] = {
        ratio: contrast(fg, bg),
        need: thresholdOf(el),
        fg: toHex({ ...fg, a: 1 }),
        bg: toHex(bg),
      };
    }

    setResults(measured);
  }, [theme]);

  const failing = Object.values(results).filter((r) => r.ratio < r.need).length;
  const total = Object.keys(results).length;

  const bind = (key: string) => (node: HTMLElement | null) => {
    if (node) hosts.current.set(key, node);
  };

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Đo tương phản màu — WCAG 2.1 AA</h1>
        <Button variant="secondary" onClick={toggle}>
          Đang xem bộ {theme === "dark" ? "TỐI" : "SÁNG"} — bấm để đổi
        </Button>
      </header>

      <p className={styles.lead}>
        Mỗi dòng vẽ thành phần thật rồi đọc màu chữ với màu nền bằng{" "}
        <code>getComputedStyle</code> ngay trên nó. Ngưỡng AA là 4,5:1 cho chữ thường và 3,0:1 cho
        chữ lớn. Bộ {theme === "dark" ? "tối" : "sáng"} đang có {failing} dòng không đạt trên{" "}
        {total} dòng — bấm nút góc phải để so hai bộ màu.
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Đo trên thành phần thật</h2>
        <div className={styles.rows}>
          {SAMPLES.map((sample) => (
            <div key={sample.id} className={styles.row}>
              <div className={styles.sampleWrap}>
                <span className={styles.sampleLabel}>{sample.label}</span>
                <div
                  className={sample.onPageBg ? styles.onPageBg : undefined}
                  ref={bind(sample.id)}
                >
                  {sample.render()}
                </div>
              </div>
              <Verdict result={results[sample.id]} />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Đo thẳng cặp biến — trạng thái không đo lại được</h2>
        <div className={styles.rows}>
          {TOKEN_PAIRS.map((pair) => (
            <div key={pair.id} className={styles.row}>
              <div className={styles.sampleWrap}>
                <span className={styles.sampleLabel}>
                  {pair.label} — <code>{pair.fg}</code> trên <code>{pair.bg}</code>
                </span>
                <div ref={bind(pair.id)}>
                  <span
                    className={styles.swatchBox}
                    style={{ background: `var(${pair.bg})`, color: `var(${pair.fg})` }}
                  >
                    Lưu thay đổi
                  </span>
                </div>
              </div>
              <Verdict result={results[pair.id]} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Verdict({ result }: { result?: Result }) {
  if (!result) return <span className={styles.need}>đang đo…</span>;
  const pass = result.ratio >= result.need;
  return (
    <div className={styles.verdict}>
      <div>
        <div className={styles.ratio}>{result.ratio.toFixed(2)}:1</div>
        <div className={styles.colors}>
          {result.fg} trên {result.bg}
        </div>
      </div>
      <div>
        <span className={`${styles.mark} ${pass ? styles.pass : styles.fail}`}>
          {pass ? "✓ đạt" : "✕ không đạt"}
        </span>
        <div className={styles.need}>cần {result.need.toFixed(1)}:1</div>
      </div>
    </div>
  );
}
