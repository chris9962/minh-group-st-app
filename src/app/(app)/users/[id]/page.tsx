"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ChartColumn, ChevronLeft, ExternalLink } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { KpiAdjustmentSection } from "@/components/people/KpiAdjustmentSection";
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
import { PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { periodMonth, periodParam, type PeriodMode } from "@/lib/api/people";
import {
  fetchPerson,
  fetchPersonAccounts,
  fetchPersonCustomers,
  fetchPersonInsurance,
  fetchPersonServices,
  type PersonAccount,
  type PersonCustomer,
  type PersonInsurance,
  type PersonService,
} from "@/lib/api/person";
import { INSURANCE_STATUS_LABEL } from "@/lib/api/insuranceOrders";
import { sourceColor, useChartColors } from "@/lib/chart-colors";
import { businessDay, formatDate, formatPhone, monthRange } from "@/lib/format";
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
  // Bốn bảng tab phân trang ở máy chủ — `date` là khoá duy nhất trong danh
  // sách trắng của route.
  sortable: true,
  render: (row: { date: string }) => formatDate(row.date),
};

/**
 * Ô tên khách — bấm sang hồ sơ khách hàng.
 *
 * Mở một hồ sơ khách theo id không áp trục phạm vi (spec §2.1b) nên ai đăng nhập
 * cũng mở được; không phải kiểm quyền trước khi dựng link như cột Đơn vị ở bảng
 * nhân sự. Phạm vi phòng chỉ siết BẢNG P-40, không siết đường này.
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

/**
 * Mở chi tiết tài khoản ngân hàng ở tab mới — cùng lý do với `OrderLinkCell`.
 * Ẩn khi người xem không có quyền xem tài khoản.
 */
function AccountLinkCell({ id }: { id: string }) {
  const user = useSession((s) => s.user);
  if (!can(user, "banking", "view-detail")) return null;
  return (
    <Link
      href={`/banking/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-secondary"
      aria-label="Mở chi tiết tài khoản ở tab mới"
    >
      <ExternalLink size={16} aria-hidden />
    </Link>
  );
}

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
  { key: "open", label: "Chi tiết", render: (a) => <AccountLinkCell id={a.id} /> },
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
      className="btn btn-secondary"
      aria-label="Mở đơn bảo hiểm ở tab mới"
    >
      <ExternalLink size={16} aria-hidden />
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
  const router = useRouter();
  const chartColors = useChartColors();
  const [period, setPeriod] = useState<PeriodMode>({ kind: "this-month" });
  const [tab, setTab] = useState<TabKey>("accounts");
  /** Tab ngoài: hồ sơ KPI hay thẻ tài khoản đăng nhập. */
  const [section, setSection] = useState<SectionKey>("kpi");

  const current = thisMonth();
  /* Khối KPI LUÔN theo tháng hiện tại (chốt 2026-08-27) — kỳ lọc chỉ đổi bốn
     danh sách hoạt động, nên `summaryMonth` không đọc từ `period`. Tháng của
     kỳ lọc (`listMonth`) chỉ dùng cho khoảng ngày và câu chú của bốn bảng. */
  const summaryMonth = current;
  const listMonth = periodMonth(period, current);
  const param = periodParam(period, current);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["person", id, param, summaryMonth],
    queryFn: () => fetchPerson({ id, period: param, summaryMonth }),
  });

  /* Bốn tab, mỗi tab một route phân trang — gọi CẢ BỐN ngay khi mở trang để
     biết tab nào có dòng mà hiện; đổi kỳ thì khoá truy vấn đổi, cả bốn tự gọi
     lại. Kỳ gửi đi là KHOẢNG NGÀY tường minh from/to, không phải token.
     Trang/chiều sắp giữ riêng từng tab. */
  const range =
    period.kind === "today"
      ? { from: businessDay(), to: businessDay() }
      : monthRange(listMonth);

  const ZERO_PAGES: Record<TabKey, number> = { customers: 0, accounts: 0, insurance: 0, services: 0 };
  const [tabPages, setTabPages] = useState<Record<TabKey, number>>(ZERO_PAGES);
  const [tabDirs, setTabDirs] = useState<Record<TabKey, SortDir>>({
    customers: "desc",
    accounts: "desc",
    insurance: "desc",
    services: "desc",
  });

  const listQuery = <T,>(
    key: TabKey,
    fetcher: (q: { id: string; from: string; to: string; page: number; dir: SortDir }) => Promise<T>,
  ) => ({
    queryKey: ["person-" + key, id, range.from, range.to, tabPages[key], tabDirs[key]],
    queryFn: () => fetcher({ id, from: range.from, to: range.to, page: tabPages[key], dir: tabDirs[key] }),
    placeholderData: keepPreviousData as never,
  });

  const customersQ = useQuery(listQuery("customers", fetchPersonCustomers));
  const accountsQ = useQuery(listQuery("accounts", fetchPersonAccounts));
  const insuranceQ = useQuery(listQuery("insurance", fetchPersonInsurance));
  const servicesQ = useQuery(listQuery("services", fetchPersonServices));

  const serverFor = (key: TabKey, total: number) => ({
    sort: "date",
    dir: tabDirs[key],
    page: tabPages[key],
    total,
    pageSize: PAGE_SIZE,
    onSortChange: (_sort: string, dir: "asc" | "desc") => {
      setTabDirs((d) => ({ ...d, [key]: dir }));
      setTabPages((p) => ({ ...p, [key]: 0 }));
    },
    onPageChange: (next: number) => setTabPages((p) => ({ ...p, [key]: next })),
  });

  // Thẻ tài khoản chỉ hiện với người quản trị được tài khoản — không có quyền
  // thì `AccountCard` trả về null, bày ra một tab rỗng cho họ bấm là vô nghĩa.
  const actor = useSession((st) => st.user);
  const canManage = can(actor, "staff", "create") || can(actor, "staff", "update");
  const showAccount = canManage && section === "account";

  const periodText = period.kind === "today" ? "Hôm nay" : monthLabel(listMonth);

  // Chỉ hiện thẻ có dòng. Thẻ rỗng chỉ để người dùng bấm vào rồi thấy trống.
  const listQueries = [customersQ, accountsQ, insuranceQ, servicesQ];
  const listsReady = listQueries.every((q) => q.isSuccess);
  /**
   * Tải HỎNG khác tải CHƯA XONG, dù `listsReady` cho ra `false` ở cả hai.
   *
   * Bản trước chỉ hỏi `isSuccess`, nên một truy vấn hỏng làm skeleton quay mãi
   * và người dùng không có nút nào để thử lại.
   */
  const listsFailed = listQueries.some((q) => q.isError);
  const listsRetrying = listQueries.some((q) => q.isFetching);
  const retryLists = () => {
    for (const q of listQueries) if (q.isError) void q.refetch();
  };
  const tabs: TabOption[] = listsReady
    ? (
        [
          { value: "customers", label: "Khách hàng", count: customersQ.data?.total ?? 0 },
          { value: "accounts", label: "Tài khoản", count: accountsQ.data?.total ?? 0 },
          { value: "insurance", label: "Đơn bảo hiểm", count: insuranceQ.data?.total ?? 0 },
          { value: "services", label: "Dịch vụ", count: servicesQ.data?.total ?? 0 },
        ] as TabOption[]
      ).filter((t) => (t.count ?? 0) > 0)
    : [];
  const activeTab = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value;

  /** Danh sách nguồn đã giữ bộ lọc trên URL; ưu tiên lịch sử trình duyệt. */
  const backToPeople = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.replace("/users");
  };

  return (
    <>
      <TopBar title={data?.fullName ?? "Nhân viên"}>
        <PeoplePeriodPicker
          value={period}
          onChange={(v) => {
            setPeriod(v);
            // Đổi kỳ là bốn danh sách đổi nội dung — trang 3 của kỳ cũ áp vào
            // kỳ mới là một khúc rỗng.
            setTabPages(ZERO_PAGES);
          }}
        />
      </TopBar>

      <main className={styles.body}>
        <button type="button" className={styles.back} onClick={backToPeople}>
          <ChevronLeft size={15} aria-hidden />
          Nhân sự &amp; KPI
        </button>

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
              <PersonKpiPanel person={data} />
              <KpiAdjustmentSection person={data} />
            </aside>

            <div className={styles.content}>
              {listsFailed ? (
                <ErrorState
                  what="hoạt động của nhân viên này"
                  onRetry={retryLists}
                  retrying={listsRetrying}
                />
              ) : !listsReady ? (
                <SkeletonCard lines={4} />
              ) : tabs.length === 0 ? (
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
                        rows={customersQ.data?.rows ?? []}
                        columns={CUSTOMER_COLUMNS}
                        rowKey={(c) => c.id}
                        defaultSort="date"
                        caption={`Khách hàng đã lập hồ sơ ${periodText}`}
                        server={serverFor("customers", customersQ.data?.total ?? 0)}
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
                        rows={accountsQ.data?.rows ?? []}
                        columns={ACCOUNT_COLUMNS}
                        rowKey={(a) => a.id}
                        defaultSort="date"
                        caption={`Tài khoản ngân hàng đã mở ${periodText}`}
                        server={serverFor("accounts", accountsQ.data?.total ?? 0)}
                      />
                    </div>
                  )}

                  {activeTab === "insurance" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={insuranceQ.data?.rows ?? []}
                        columns={INSURANCE_COLUMNS}
                        rowKey={(o) => o.id}
                        defaultSort="date"
                        caption={`Đơn bảo hiểm đã tạo ${periodText}`}
                        server={serverFor("insurance", insuranceQ.data?.total ?? 0)}
                      />
                    </div>
                  )}

                  {activeTab === "services" && (
                    <div className={styles.panel}>
                      <RankTable
                        rows={servicesQ.data?.rows ?? []}
                        columns={SERVICE_COLUMNS}
                        rowKey={(s) => s.id}
                        defaultSort="date"
                        caption={`Dịch vụ đã làm cho khách ${periodText}`}
                        server={serverFor("services", servicesQ.data?.total ?? 0)}
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
