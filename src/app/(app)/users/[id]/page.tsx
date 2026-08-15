"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { ChartColumn, ChevronLeft, SquareArrowOutUpRight } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { PersonKpiPanel } from "@/components/people/PersonKpiPanel";
import { AccountCard } from "@/components/staff/AccountCard";
import { BarChart } from "@/components/ui/BarChart";
import { monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { PeoplePeriodPicker } from "@/components/ui/PeoplePeriodPicker";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionTabs, type SectionOption } from "@/components/ui/SectionTabs";
import { SegmentedTabs, type TabOption } from "@/components/ui/SegmentedTabs";
import { StatusTag } from "@/components/ui/StatusTag";
import { periodMonth, periodParam, showsKpi, type PeriodMode } from "@/lib/api/people";
import {
  fetchPerson,
  type PersonAccount,
  type PersonCustomer,
  type PersonInsurance,
  type PersonService,
} from "@/lib/api/person";
import { INSURANCE_STATUS_LABEL } from "@/lib/api/insuranceOrders";
import { sourceColor, useChartColors } from "@/lib/chart-colors";
import { formatDate, formatPhone } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";
import { PRODUCT_LABEL } from "@/lib/types";

/** Sắp theo ngày cần một con số — lấy chính chuỗi YYYY-MM-DD bỏ dấu gạch. */
const dateOrder = (row: { date: string }) => Number(row.date.replace(/-/g, ""));

const DATE_COLUMN = {
  key: "date",
  label: "Ngày",
  sortBy: dateOrder,
  render: (row: { date: string }) => formatDate(row.date),
};

/**
 * Ô tên khách — bấm sang hồ sơ khách hàng.
 *
 * Hồ sơ khách KHÔNG áp trục phạm vi (spec §2.1b) nên ai đăng nhập cũng mở được;
 * không phải kiểm quyền trước khi dựng link như cột Đơn vị ở bảng nhân sự.
 */
function CustomerCell({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/customers/${id}`} className={styles.nameLink}>
      {name}
    </Link>
  );
}

/** Khách do người này lập hồ sơ trong kỳ. */
const CUSTOMER_COLUMNS: RankColumn<PersonCustomer>[] = [
  DATE_COLUMN,
  {
    key: "fullName",
    label: "Khách hàng",
    render: (c) => <CustomerCell id={c.id} name={c.fullName} />,
  },
  { key: "phone", label: "Số điện thoại", render: (c) => formatPhone(c.phone) || "—" },
  { key: "channel", label: "Kênh", render: (c) => c.channel || "—" },
  {
    key: "accountCount",
    label: "Tài khoản",
    sortBy: (c) => c.accountCount,
    render: (c) => c.accountCount,
  },
  {
    key: "insuranceCount",
    label: "Đơn bảo hiểm",
    sortBy: (c) => c.insuranceCount,
    render: (c) => c.insuranceCount,
  },
];

/** Một hàng một tài khoản — cùng lối với bảng Ngân hàng P-21 (chốt 2026-08-15). */
const ACCOUNT_COLUMNS: RankColumn<PersonAccount>[] = [
  DATE_COLUMN,
  {
    key: "customerName",
    label: "Khách hàng",
    render: (a) => <CustomerCell id={a.customerId} name={a.customerName} />,
  },
  { key: "bankName", label: "Ngân hàng", render: (a) => a.bankName },
  { key: "referralCode", label: "Mã giới thiệu", render: (a) => a.referralCode },
  { key: "channel", label: "Kênh", render: (a) => a.channel || "" },
  {
    key: "appInstalled",
    label: "Đã cài app",
    render: (a) =>
      a.appInstalled ? (
        <StatusTag ok>{a.accountType === "none" ? "Có" : `Có (${a.accountType})`}</StatusTag>
      ) : (
        <StatusTag ok={false}>Chưa</StatusTag>
      ),
  },
];

/**
 * Mở đơn bảo hiểm ở tab mới.
 *
 * Tab mới chứ không điều hướng tại chỗ: người xem đang dò một bảng dài, mở tại
 * chỗ là mất luôn kỳ đang chọn và vị trí cuộn, quay lại phải dò từ đầu.
 *
 * Ẩn khi người xem không có quyền xem đơn — bấm vào chỉ nhận một màn báo lỗi.
 */
function OrderLinkCell({ id }: { id: string }) {
  const user = useSession((s) => s.user);
  if (!can(user, "insurance", "view-detail")) return null;
  return (
    <Link
      href={`/insurance/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.openLink}
      aria-label="Mở đơn bảo hiểm ở tab mới"
    >
      <SquareArrowOutUpRight size={15} aria-hidden />
    </Link>
  );
}

const INSURANCE_COLUMNS: RankColumn<PersonInsurance>[] = [
  DATE_COLUMN,
  {
    key: "customerName",
    label: "Khách hàng",
    render: (o) => <CustomerCell id={o.customerId} name={o.customerName} />,
  },
  { key: "product", label: "Loại bảo hiểm", render: (o) => PRODUCT_LABEL[o.product] },
  { key: "packageName", label: "Gói", render: (o) => o.packageName },
  {
    key: "status",
    label: "Trạng thái",
    render: (o) => (
      <StatusTag ok={o.status === "done"}>{INSURANCE_STATUS_LABEL[o.status]}</StatusTag>
    ),
  },
  { key: "open", label: "Chi tiết", render: (o) => <OrderLinkCell id={o.id} /> },
];

const SERVICE_COLUMNS: RankColumn<PersonService>[] = [
  DATE_COLUMN,
  {
    key: "customerName",
    label: "Khách hàng",
    render: (s) => <CustomerCell id={s.customerId} name={s.customerName} />,
  },
  { key: "serviceType", label: "Loại dịch vụ", render: (s) => s.serviceType },
  { key: "ward", label: "Xã", render: (s) => s.ward || "—" },
  {
    key: "points",
    label: "Điểm",
    sortBy: (s) => s.points,
    render: (s) => s.points,
  },
];

/** Chữ cái đầu của họ và tên — ảnh đại diện tạm khi chưa có ảnh thật. */
const initialsOf = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
};

/** Nhãn cột biểu đồ: `2026-07` → `T7`. */
const shortMonth = (month: string) => `T${Number(month.slice(5, 7))}`;

type TabKey = "customers" | "accounts" | "insurance" | "services";

/**
 * Tab ngoài. Cố ý KHÔNG gọi tab thứ hai là "Tài khoản": bên trong tab thứ nhất
 * đã có một tab tên "Tài khoản" nghĩa là tài khoản NGÂN HÀNG của khách. Hai chữ
 * giống nhau ở hai tầng chỉ tổ làm người dùng bấm nhầm.
 */
type SectionKey = "kpi" | "account";

const SECTIONS: SectionOption[] = [
  { value: "kpi", label: "KPI & hoạt động" },
  { value: "account", label: "Tài khoản & quyền" },
];

/** P-52 · Xem theo một nhân viên. */
export default function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const chartColors = useChartColors();
  const [period, setPeriod] = useState<PeriodMode>({ kind: "this-month" });
  const [tab, setTab] = useState<TabKey>("accounts");
  /** Tab ngoài: hồ sơ KPI hay thẻ tài khoản đăng nhập. */
  const [section, setSection] = useState<SectionKey>("kpi");

  const current = thisMonth();
  const summaryMonth = periodMonth(period, current);
  const param = periodParam(period, current);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["person", id, param, summaryMonth],
    queryFn: () => fetchPerson({ id, period: param, summaryMonth }),
  });

  // Thẻ tài khoản chỉ hiện với người quản trị được tài khoản — không có quyền
  // thì `AccountCard` trả về null, bày ra một tab rỗng cho họ bấm là vô nghĩa.
  const actor = useSession((st) => st.user);
  const canManage = can(actor, "staff", "create") || can(actor, "staff", "update");
  const showAccount = canManage && section === "account";

  const withKpi = showsKpi(period);
  const periodText = period.kind === "today" ? "Hôm nay" : monthLabel(summaryMonth);

  // Chỉ hiện thẻ có dòng. Thẻ rỗng chỉ để người dùng bấm vào rồi thấy trống.
  const tabs: TabOption[] = data
    ? (
        [
          { value: "customers", label: "Khách hàng", count: data.customers.length },
          { value: "accounts", label: "Tài khoản", count: data.accounts.length },
          { value: "insurance", label: "Đơn bảo hiểm", count: data.insurance.length },
          { value: "services", label: "Dịch vụ", count: data.services.length },
        ] as TabOption[]
      ).filter((t) => (t.count ?? 0) > 0)
    : [];
  const activeTab = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value;

  return (
    <>
      <TopBar title={data?.fullName ?? "Nhân viên"}>
        <PeoplePeriodPicker value={period} onChange={setPeriod} />
      </TopBar>

      <main className={styles.body}>
        <Link href="/users" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Nhân sự &amp; KPI
        </Link>

        {isPending && <SkeletonCard lines={5} />}
        {isError && (
          <ErrorState what="hồ sơ nhân viên này" onRetry={refetch} retrying={isFetching} />
        )}

        {data && canManage && (
          <SectionTabs
            label="Khu vực hồ sơ"
            options={SECTIONS}
            value={section}
            onChange={(v) => setSection(v as SectionKey)}
          />
        )}

        {data && showAccount && (
          <div className={styles.accountSection}>
            <AccountCard staffId={id} />
          </div>
        )}

        {data && !showAccount && (
          <div className={styles.columns}>
            <aside className={styles.side}>
              <PersonKpiPanel person={data} withKpi={withKpi} />
            </aside>

            <div className={styles.content}>
              {tabs.length === 0 ? (
                <p className="text-muted">
                  {periodText} chưa có hoạt động nào của {data.fullName}.
                </p>
              ) : (
                <>
                  <SegmentedTabs
                    label="Loại hoạt động"
                    options={tabs}
                    value={activeTab ?? "accounts"}
                    onChange={(v) => setTab(v as TabKey)}
                  />

                  {activeTab === "customers" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={data.customers}
                        columns={CUSTOMER_COLUMNS}
                        rowKey={(c) => c.id}
                        defaultSort="date"
                        pageSize={10}
                        caption={`Khách hàng đã lập hồ sơ ${periodText}`}
                      />
                      <p className={styles.footnote}>
                        Hai cột đếm là TỔNG của khách đó, không giới hạn trong kỳ
                        đang xem — một khách lập tháng này vẫn hiện đủ tài khoản
                        và đơn của những tháng trước.
                      </p>
                    </div>
                  )}

                  {activeTab === "accounts" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={data.accounts}
                        columns={ACCOUNT_COLUMNS}
                        rowKey={(a) => a.id}
                        defaultSort="date"
                        pageSize={10}
                        caption={`Tài khoản ngân hàng đã mở ${periodText}`}
                      />
                    </div>
                  )}

                  {activeTab === "insurance" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={data.insurance}
                        columns={INSURANCE_COLUMNS}
                        rowKey={(o) => o.id}
                        defaultSort="date"
                        pageSize={10}
                        caption={`Đơn bảo hiểm đã tạo ${periodText}`}
                      />
                    </div>
                  )}

                  {activeTab === "services" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={data.services}
                        columns={SERVICE_COLUMNS}
                        rowKey={(s) => s.id}
                        defaultSort="date"
                        pageSize={10}
                        caption={`Dịch vụ đã làm cho khách ${periodText}`}
                      />
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        )}
      </main>
    </>
  );
}
