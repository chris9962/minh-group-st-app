"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { ScoringTable } from "@/components/exports/ScoringTable";
import { HandledOrdersTable } from "@/components/people/HandledOrdersTable";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SegmentedTabs, type TabOption } from "@/components/ui/SegmentedTabs";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  BANK_ACCOUNT_STATUS_LABEL,
  BANK_ACCOUNT_STATUS_TONE,
} from "@/lib/api/bankAccounts";
import { INSURANCE_STATUS_LABEL } from "@/lib/api/insuranceOrders";
import { PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import {
  fetchPersonAccounts,
  fetchPersonCustomers,
  fetchPersonHandled,
  fetchPersonInsurance,
  fetchPersonServices,
  type PersonAccount,
  type PersonCustomer,
  type PersonInsurance,
  type PersonService,
} from "@/lib/api/person";
import { formatDate, formatPhone, formatPoints } from "@/lib/format";
import { can } from "@/lib/permissions";
import { PRODUCT_LABEL } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./PersonActivityTabs.module.scss";

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

/**
 * Khách do người này lập hồ sơ trong kỳ.
 *
 * Ba cột số cuối đo hai mốc thời gian khác nhau, và bảng không nói ra điều đó:
 * `accountCount`/`insuranceCount` là tổng từ trước tới giờ của khách (hai cột
 * đếm lưu sẵn, db-design §9), còn `points` chỉ tính tài khoản mở TRONG tháng
 * đang xem vì tổ hợp không nối qua tháng (thể lệ câu 7.13). Khách lập 2026-09-02
 * từng mở 2 tài khoản tháng 8 và 1 tài khoản tháng 9 ra "3 tài khoản" mà điểm
 * chỉ tính một.
 */
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
  // Chỉ điểm combo ngân hàng. Điểm dịch vụ đã có cột riêng ở tab Dịch vụ, cộng
  // vào đây là một con số đếm hai lần ở hai tab.
  {
    key: "points",
    label: "Điểm",
    sortBy: (c) => c.points,
    render: (c) => formatPoints(c.points),
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
  {
    key: "status",
    label: "Trạng thái",
    render: (a) => (
      <StatusTag tone={BANK_ACCOUNT_STATUS_TONE[a.status]}>
        {BANK_ACCOUNT_STATUS_LABEL[a.status]}
      </StatusTag>
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

/**
 * `scoring` KHÁC bốn tab kia: nó không đọc kỳ của trang và không phân trang ở
 * máy chủ. Bảng điểm có ô chọn khoảng ngày riêng bên trong.
 */
type TabKey = "customers" | "accounts" | "insurance" | "handled" | "services" | "scoring";

type ListTabKey = Exclude<TabKey, "scoring">;

const ZERO_PAGES: Record<ListTabKey, number> = {
  customers: 0,
  accounts: 0,
  insurance: 0,
  handled: 0,
  services: 0,
};

type Props = {
  staffId: string;
  /** Kỳ đã quy về hai ngày `YYYY-MM-DD`; hai màn dùng hai ô chọn kỳ khác nhau. */
  from: string;
  to: string;
  /** "Hôm nay" · "T9/2026" — đi vào câu chú của bốn bảng. */
  periodText: string;
  /** Số đơn huỷ trong kỳ, hiện thành dòng phụ ở tab Đơn bảo hiểm. */
  insuranceCancelled: number;
  /** Câu báo rỗng gọi tên ai — trống thì viết "chưa có hoạt động nào". */
  personName?: string;
};

/**
 * Bốn tab hoạt động của MỘT người: khách hàng · tài khoản · đơn bảo hiểm · dịch vụ.
 *
 * Tách ra vì hai màn cần đúng khối này: hồ sơ nhân viên P-52 (cấp trên xem) và
 * màn Tổng quan của chính nhân viên đó (tự xem) — AGENTS.md §2.
 *
 * Kỳ vào bằng hai ngày chứ không bằng kiểu kỳ: P-52 dùng `PeriodMode`, màn Tổng
 * quan dùng `Period`, mà cả hai đều quy về from/to trước khi gọi máy chủ.
 *
 * ⚠️ Nơi gọi PHẢI đặt `key={`${from}:${to}`}`. Trang và chiều sắp của bốn tab
 * nằm trong state của chính khối này, mà đổi kỳ là bốn danh sách đổi nội dung —
 * giữ trang 3 của kỳ cũ là hiện một khúc rỗng (AGENTS.md §7: reset theo prop
 * bằng `key`, không phải effect).
 */
export function PersonActivityTabs({
  staffId,
  from,
  to,
  periodText,
  insuranceCancelled,
  personName,
}: Props) {
  const [tab, setTab] = useState<TabKey>("customers");
  const [tabPages, setTabPages] = useState<Record<ListTabKey, number>>(ZERO_PAGES);
  const [tabDirs, setTabDirs] = useState<Record<ListTabKey, SortDir>>({
    customers: "desc",
    accounts: "desc",
    insurance: "desc",
    handled: "desc",
    services: "desc",
  });

  /* Bốn tab, mỗi tab một route phân trang — gọi CẢ BỐN ngay khi mở để biết tab
     nào có dòng mà hiện; đổi kỳ thì khoá truy vấn đổi, cả bốn tự gọi lại. */
  const listQuery = <T,>(
    key: ListTabKey,
    fetcher: (q: {
      id: string;
      from: string;
      to: string;
      page: number;
      dir: SortDir;
    }) => Promise<T>,
  ) => ({
    queryKey: ["person-" + key, staffId, from, to, tabPages[key], tabDirs[key]],
    queryFn: () =>
      fetcher({ id: staffId, from, to, page: tabPages[key], dir: tabDirs[key] }),
    placeholderData: keepPreviousData as never,
  });

  const customersQ = useQuery(listQuery("customers", fetchPersonCustomers));
  const accountsQ = useQuery(listQuery("accounts", fetchPersonAccounts));
  const insuranceQ = useQuery(listQuery("insurance", fetchPersonInsurance));
  const handledQ = useQuery(listQuery("handled", fetchPersonHandled));
  const servicesQ = useQuery(listQuery("services", fetchPersonServices));

  const serverFor = (key: ListTabKey, total: number) => ({
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

  // Chỉ hiện thẻ có dòng. Thẻ rỗng chỉ để người dùng bấm vào rồi thấy trống.
  const listQueries = [customersQ, accountsQ, insuranceQ, handledQ, servicesQ];
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
          /* Chỉ hiện khi người này thật sự đã xử lý đơn nào — cùng luật với bốn
             tab kia. Không hỏi quyền `insurance:handle-fallback` của họ: quyền
             của NGƯỜI KHÁC không có ở trình duyệt, mà người không có quyền đó
             thì không bao giờ có dòng nào ở đây. */
          { value: "handled", label: "Đơn đã xử lý", count: handledQ.data?.total ?? 0 },
          { value: "services", label: "Dịch vụ", count: servicesQ.data?.total ?? 0 },
        ] as TabOption[]
      )
        .filter((t) => (t.count ?? 0) > 0)
        // Bảng điểm LUÔN hiện, kể cả khi bốn tab kia rỗng: nó chạy theo khoảng
        // ngày riêng, nên kỳ của trang không nói được nó có dòng hay không.
        .concat([{ value: "scoring", label: "Bảng điểm" }])
    : [];
  const activeTab = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value;

  if (listsFailed) {
    return (
      <ErrorState
        what="hoạt động trong kỳ"
        onRetry={retryLists}
        retrying={listsRetrying}
      />
    );
  }
  if (!listsReady) return <SkeletonCard lines={4} />;
  if (tabs.length === 0) {
    return (
      <p className="text-muted">
        {periodText} chưa có hoạt động nào{personName ? ` của ${personName}` : ""}.
      </p>
    );
  }

  return (
    <div className={styles.wrap}>
      <SegmentedTabs
        label="Loại hoạt động"
        options={tabs}
        value={activeTab ?? "customers"}
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
          {/* Bảng liệt kê CẢ đơn huỷ để tra cứu được, nhưng ô sản lượng ở màn
              Tổng quan thì không tính chúng. Nói rõ có bao nhiêu đơn huỷ để hai
              con số đọc ra khớp nhau. */}
          {insuranceCancelled > 0 && (
            <p className="text-muted">
              {insuranceCancelled} đơn huỷ {periodText}
            </p>
          )}
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

      {activeTab === "handled" && (
        <div className={styles.panel}>
          <HandledOrdersTable
            staffId={staffId}
            from={from}
            to={to}
            periodText={periodText}
            page={tabPages.handled}
            dir={tabDirs.handled}
            onPageChange={(next) => setTabPages((p) => ({ ...p, handled: next }))}
            onDirChange={(next) => setTabDirs((d) => ({ ...d, handled: next }))}
            data={handledQ.data}
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

      {/* Không bọc `styles.panel`: `ScoringTable` tự dựng thẻ của nó, lồng hai
          lớp thẻ vào nhau là hai đường viền chồng lên nhau. */}
      {activeTab === "scoring" && <ScoringTable lockedStaffId={staffId} pageSize={50} />}
    </div>
  );
}
