"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays, ListX, ScanSearch, UserCheck, Wrench } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonTable } from "@/components/ui/Skeleton";
import {
  fetchPhotoCheckStats,
  type PhotoCheckFixBy,
  type PhotoCheckStatsDay,
} from "@/lib/api/photoCheckStats";
import { formatCount, formatDate } from "@/lib/format";
import styles from "./PhotoCheckStatsPanel.module.scss";

type Line = { label: string; count: number; ratio: number };

const share = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);
const percent = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatShare = (value: number) => `${percent.format(value)}%`;
const countCell = (value: number) => <span className="tabular-nums">{formatCount(value)}</span>;
const shareCell = (value: number) => <span className="tabular-nums">{formatShare(value)}</span>;

const lineColumns = (label: string, ratioLabel: string): RankColumn<Line>[] => [
  { key: "label", label, render: (r) => r.label },
  { key: "count", label: "Số tài khoản", render: (r) => countCell(r.count) },
  { key: "ratio", label: ratioLabel, ratio: (r) => r.ratio, render: (r) => shareCell(r.ratio) },
];

const BOT_COLUMNS = lineColumns("Kết quả", "Tỷ lệ");
const REVIEW_COLUMNS = lineColumns("Trường hợp", "Tỷ lệ");
const REASON_COLUMNS = lineColumns("Lý do", "Tỷ lệ trên số không đạt");

const FIX_LABEL: Record<PhotoCheckFixBy, string> = {
  self: "Nhân viên tự sửa theo thông báo của bot",
  "after-error": "Nhân viên sửa sau khi người duyệt đánh lỗi",
  "code-change": "Người quản ngân hàng chọn mã giới thiệu khác cho tài khoản",
  none: "Chưa sửa",
};

type FixLine = Line & { by: PhotoCheckFixBy; passed: number; medianMinutes: number | null };

const formatWait = (minutes: number | null) => {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} phút`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} giờ`;
  return `${Math.round(minutes / (24 * 60))} ngày`;
};

const FIX_COLUMNS: RankColumn<FixLine>[] = [
  ...lineColumns("Lý do sửa", "Tỷ lệ trên số lượt 1 không đạt"),
  {
    key: "passed",
    label: "Bot chấm lại đạt",
    render: (r) => (
      <span className="tabular-nums">
        {formatCount(r.passed)} ({formatShare(share(r.passed, r.count))})
      </span>
    ),
  },
  { key: "wait", label: "Trung vị thời gian tới lần sửa", render: (r) => formatWait(r.medianMinutes) },
];

const DAY_COLUMNS: RankColumn<PhotoCheckStatsDay>[] = [
  { key: "day", label: "Ngày", render: (r) => formatDate(r.day) },
  { key: "total", label: "Tổng", render: (r) => countCell(r.total) },
  { key: "passed", label: "Bot đạt", render: (r) => countCell(r.passed) },
  { key: "failed", label: "Bot không đạt", render: (r) => countCell(r.failed) },
  {
    key: "rate",
    label: "Tỷ lệ đạt",
    ratio: (r) => share(r.passed, r.total),
    render: (r) => shareCell(share(r.passed, r.total)),
  },
];

type Props = {
  bankId: string;
  /** `YYYY-MM-DD` hoặc `''`, cùng bộ lọc ngày với hai tab còn lại của trang. */
  from: string;
  to: string;
  inScope: boolean;
};

/** Tab Hiệu suất kiểm ảnh: cùng bố cục với file Excel đánh giá bot TPB (2026-09-28). */
export function PhotoCheckStatsPanel({ bankId, from, to, inScope }: Props) {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["photo-check-stats", bankId, from, to],
    queryFn: () => fetchPhotoCheckStats(bankId, { from, to }),
    enabled: inScope,
    placeholderData: keepPreviousData,
  });

  const head = { title: "Kết quả bot kiểm ảnh", icon: <ScanSearch size={17} /> };
  if (!inScope) {
    return (
      <SectionCard {...head}>
        <p className="text-muted">Bạn không quản ngân hàng này.</p>
      </SectionCard>
    );
  }
  if (isError) {
    return (
      <SectionCard {...head}>
        <ErrorState what="số liệu kiểm ảnh của ngân hàng này" onRetry={refetch} retrying={isFetching} />
      </SectionCard>
    );
  }
  if (isPending) {
    return (
      <SectionCard {...head}>
        <SkeletonTable rows={4} columns={3} />
      </SectionCard>
    );
  }

  const botLines: Line[] = [
    { label: "Bot chấm đạt", count: data.passed, ratio: share(data.passed, data.total) },
    { label: "Bot chấm không đạt", count: data.failed, ratio: share(data.failed, data.total) },
    {
      label: "Chưa kiểm hoặc kiểm hỏng",
      count: data.unchecked,
      ratio: share(data.unchecked, data.total),
    },
  ];
  const reviewLines: Line[] = [
    {
      label: "Bot không đạt, người duyệt xác nhận đạt",
      count: data.failedConfirmed,
      ratio: share(data.failedConfirmed, data.failed),
    },
    {
      label: "Bot không đạt, người duyệt đánh lỗi",
      count: data.failedMarkedError,
      ratio: share(data.failedMarkedError, data.failed),
    },
    {
      label: "Bot không đạt, người duyệt chưa xử lý",
      count: data.failedUnreviewed,
      ratio: share(data.failedUnreviewed, data.failed),
    },
    {
      label: "Bot đạt, người duyệt đánh lỗi",
      count: data.passedMarkedError,
      ratio: share(data.passedMarkedError, data.passed),
    },
  ];
  const firstFailed = data.fixes.reduce((acc, f) => acc + f.count, 0);
  const fixLines: FixLine[] = data.fixes.map((f) => ({
    ...f,
    label: FIX_LABEL[f.by],
    ratio: share(f.count, firstFailed),
  }));
  const reasonLines: Line[] = data.reasons.map((r) => ({
    label: r.label,
    count: r.count,
    ratio: share(r.count, data.failed),
  }));

  return (
    <div className={styles.grid}>
      <SectionCard {...head} meta={`${formatCount(data.total)} tài khoản`}>
        <RankTable
          rows={botLines}
          columns={BOT_COLUMNS}
          rowKey={(r) => r.label}
          defaultSort="label"
          caption="Kết quả bot kiểm ảnh"
          summaryRow={["Tổng số tài khoản", countCell(data.total), null]}
        />
      </SectionCard>

      <SectionCard title="Đối chiếu với người duyệt" icon={<UserCheck size={17} />}>
        <RankTable
          rows={reviewLines}
          columns={REVIEW_COLUMNS}
          rowKey={(r) => r.label}
          defaultSort="label"
          caption="Đối chiếu kết quả bot với người duyệt"
        />
      </SectionCard>

      <SectionCard
        title="Sửa sau lượt 1 không đạt"
        icon={<Wrench size={17} />}
        meta={`${formatCount(firstFailed)} tài khoản`}
        className={styles.wide}
      >
        <RankTable
          rows={fixLines}
          columns={FIX_COLUMNS}
          rowKey={(r) => r.by}
          defaultSort="label"
          caption="Lý do sửa của các tài khoản bot chấm lượt 1 không đạt"
        />
      </SectionCard>

      <SectionCard
        title="Lý do bot chấm không đạt"
        icon={<ListX size={17} />}
        meta={`${formatCount(data.failed)} tài khoản`}
      >
        <RankTable
          rows={reasonLines}
          columns={REASON_COLUMNS}
          rowKey={(r) => r.label}
          defaultSort="label"
          caption="Lý do bot chấm không đạt"
          emptyText="Không có tài khoản nào bị bot chấm không đạt."
        />
      </SectionCard>

      <SectionCard title="Theo ngày" icon={<CalendarDays size={17} />}>
        <RankTable
          rows={data.days}
          columns={DAY_COLUMNS}
          rowKey={(r) => r.day}
          defaultSort="day"
          caption="Kết quả bot kiểm ảnh theo ngày mở tài khoản"
          emptyText="Không có tài khoản nào trong khoảng ngày này."
        />
      </SectionCard>
    </div>
  );
}
