"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Gift, Landmark, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountFormDialog } from "@/components/banking/BankAccountFormDialog";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { GiftGivingDialog } from "@/components/customers/GiftGivingDialog";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import buttonStyles from "@/components/ui/Button.module.css";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { fetchChannels } from "@/lib/api/channelCatalog";
import { fetchDepartments } from "@/lib/api/departments";
import { fetchHospitals } from "@/lib/api/hospitalCatalog";
import {
  CUSTOMER_SORT,
  deleteCustomer,
  fetchCustomerDetail,
  fetchCustomers,
  type CustomerQuery,
  type CustomerRow,
  type CustomerSort,
} from "@/lib/api/customers";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { errorMessage, toast } from "@/lib/toast";
import { EMPTY_PAGE, PAGE_SIZE } from "@/lib/api/pagination";
import { formatDate, formatPhone, formatPoints } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { can, recordInScope, recordVisibility } from "@/lib/permissions";
import { isRealIsoDate } from "@/lib/types";
import { fetchStaffOptions } from "@/lib/api/staff";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Khách mới nhất lên đầu — người nhập vừa tạo xong là thấy ngay dòng của mình. */
const FIRST_PAGE: CustomerQuery = {
  search: "",
  channelId: "",
  channelDetail: "",
  staffId: "",
  departmentId: "",
  from: "",
  to: "",
  page: 0,
  sort: "created",
  dir: "desc",
};

/** URL chỉ nhận ngày có thật — `2026-02-31` không được thành tháng Ba mà không báo gì. */
const dateFromUrl = (value: string | null): Date | undefined =>
  value && isRealIsoDate(value) ? new Date(`${value}T00:00:00`) : undefined;

const pageFromUrl = (value: string | null): number => {
  const page = Number(value);
  // URL đếm từ 1 để người dùng đọc được; `RankTable` đếm từ 0 nội bộ.
  return Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0;
};

/**
 * Câu hỏi ban đầu dựng từ địa chỉ trang, để link chia sẻ mở ra đúng bộ lọc.
 *
 * `from`/`to` cố ý giữ rỗng: khoảng ngày nằm ở state `range`, và `asked` ghi hai
 * trường này từ đó mỗi lần render.
 */
const queryFromUrl = (params: URLSearchParams): CustomerQuery => {
  const sort = params.get("sort");
  return {
    ...FIRST_PAGE,
    search: params.get("search") ?? "",
    channelId: params.get("channelId") ?? "",
    channelDetail: params.get("channelDetail") ?? "",
    staffId: params.get("staffId") ?? "",
    departmentId: params.get("departmentId") ?? "",
    page: pageFromUrl(params.get("page")),
    // Khoá lạ rơi về mặc định, không làm hỏng màn — cùng lối với `pageArgsFrom`.
    sort: CUSTOMER_SORT.includes(sort as CustomerSort) ? (sort as CustomerSort) : "created",
    dir: params.get("dir") === "asc" ? "asc" : "desc",
  };
};

/**
 * Nút Sửa mở dialog NGAY — bảng chỉ có dòng tóm tắt nên hồ sơ đầy đủ tải bên
 * trong dialog: đang tải hiện skeleton, hỏng hiện nút thử lại ngay trong modal
 * (cùng lối với GiftGivingDialog).
 */
function EditCustomerDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => fetchCustomerDetail(id),
    // Không refetch khi quay lại cửa sổ: form đồng bộ theo `values` — refetch
    // giữa chừng là form reset mất chữ đang gõ.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return (
    <CustomerFormDialog
      open
      customer={data?.customer ?? null}
      loading={isPending}
      loadError={isError ? { onRetry: () => void refetch(), retrying: isFetching } : null}
      onClose={onClose}
    />
  );
}

/**
 * P-40 · Danh sách khách hàng — không áp phạm vi, ai đăng nhập cũng thấy hết.
 *
 * Tìm, lọc, sắp và cắt trang đều do máy chủ làm (AGENTS.md §5.1). Màn này chỉ
 * giữ CÂU HỎI trong `query` rồi hiện đúng những gì máy chủ trả về — không có
 * chỗ nào lọc lại hay sắp lại trên dữ liệu đã tải.
 */
export default function CustomersPage() {
  const user = useSession((s) => s.user);
  const searchParams = useSearchParams();
  const [query, setQuery] = useState<CustomerQuery>(() => queryFromUrl(searchParams));
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [givingGiftTo, setGivingGiftTo] = useState<CustomerRow | null>(null);
  const [openingBankFor, setOpeningBankFor] = useState<CustomerRow | null>(null);
  const [loggingServiceFor, setLoggingServiceFor] = useState<CustomerRow | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<CustomerRow | null>(null);

  // Ô tìm giữ chữ đang gõ riêng, chỉ hoãn xong mới thành câu hỏi gửi đi — nối
  // thẳng vào `query` thì mỗi phím là một lượt gọi máy chủ.
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const debouncedSearch = useDebouncedValue(search);
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = dateFromUrl(searchParams.get("from"));
    const to = dateFromUrl(searchParams.get("to"));
    return from || to ? { from, to } : undefined;
  });

  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  /**
   * Ô lọc bệnh viện chỉ có nghĩa khi kênh đang chọn nhận đầu vào là bệnh viện.
   * Đọc `inputKind` chứ không so tên kênh: admin đổi tên kênh bất cứ lúc nào,
   * và spec §2.3 đã nói rõ đây là dữ liệu chứ không phải nhánh code theo tên.
   */
  const channelTakesHospital =
    channels.find((c) => c.id === query.channelId)?.inputKind === "hospital";
  const { data: hospitals = [] } = useQuery({
    queryKey: ["hospitals"],
    queryFn: fetchHospitals,
    staleTime: Infinity,
    enabled: channelTakesHospital,
  });

  /**
   * Ô lọc "Nhân viên" đọc TRỌN danh sách nhân sự, không gom từ các dòng đang
   * hiện — gom từ dòng thì chỉ chọn được người tình cờ nằm ở trang đang xem.
   *
   * Gác bằng `staff:view-detail` vì đó đúng là quyền mà route danh sách nhân sự
   * đòi. Nhân viên không có quyền đó, và họ cũng không cần ô này: bảng của họ
   * đã chỉ có khách của chính mình.
   */
  const canFilterByStaff = can(user, "staff", "view-detail");
  const { data: staff = [] } = useQuery({
    queryKey: ["staff", "options", "active"],
    queryFn: () => fetchStaffOptions({ status: "active" }),
    retry: false,
    staleTime: Infinity,
    enabled: canFilterByStaff,
  });
  const staffOptions = useMemo(
    () => staff.map((s) => ({ value: s.id, label: s.fullName })),
    [staff],
  );

  const queryClient = useQueryClient();
  const removeCustomer = useMutation({
    mutationFn: (customerId: string) => deleteCustomer(customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setDeletingCustomer(null);
      toast.ok("Đã xoá hồ sơ khách");
    },
    // Giữ hộp thoại mở: câu báo nói khách còn mấy tài khoản, mấy đơn, và người
    // dùng cần đọc nó cạnh tên khách chứ không phải trên một bảng đã đóng.
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được hồ sơ khách này.")),
  });

  /**
   * Ô lọc "Phòng" chỉ có nghĩa khi phạm vi đọc của người xem trải qua NHIỀU
   * phòng. Nhân viên chỉ thấy khách mình lập, còn quản lý đúng một phòng thì mọi
   * dòng đã cùng phòng đó — ô lọc ra chính bảng đang xem.
   */
  const canFilterByDepartment = useMemo(() => {
    const scope = recordVisibility(user, "customer", "view-detail");
    return scope.kind === "all" || (scope.kind === "departments" && scope.departmentIds.length > 1);
  }, [user]);
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    retry: false,
    staleTime: Infinity,
    enabled: canFilterByDepartment,
  });
  /**
   * Danh sách cắt theo phạm vi người xem: phòng ngoài phạm vi luôn cho bảng
   * rỗng, và một dòng chọn luôn ra rỗng là dòng đặt sai chỗ.
   */
  const departmentOptions = useMemo(() => {
    const scope = recordVisibility(user, "customer", "view-detail");
    const inScope =
      scope.kind === "departments"
        ? departments.filter((d) => scope.departmentIds.includes(d.id))
        : departments;
    return inScope.map((d) => ({ value: d.id, label: d.name }));
  }, [user, departments]);

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";
  const asked: CustomerQuery = { ...query, search: debouncedSearch, from, to };

  /**
   * Danh sách là một trạng thái quay lại và chia sẻ được, nên mọi thứ làm đổi
   * kết quả đều nằm trên URL. `replaceState` không thêm một mục lịch sử theo
   * từng ký tự gõ.
   */
  const listUrl = (() => {
    const params = new URLSearchParams();
    if (asked.search) params.set("search", asked.search);
    if (asked.from) params.set("from", asked.from);
    if (asked.to) params.set("to", asked.to);
    if (asked.departmentId) params.set("departmentId", asked.departmentId);
    if (asked.channelId) params.set("channelId", asked.channelId);
    if (asked.channelDetail) params.set("channelDetail", asked.channelDetail);
    if (asked.staffId) params.set("staffId", asked.staffId);
    if (asked.page > 0) params.set("page", String(asked.page + 1));
    if (asked.sort !== "created") params.set("sort", asked.sort);
    if (asked.dir === "asc") params.set("dir", asked.dir);
    const query = params.toString();
    return query ? `/customers?${query}` : "/customers";
  })();

  // Chuỗi so bằng giá trị nên effect chỉ chạy khi địa chỉ thật sự đổi. Không
  // bọc `useMemo`: `asked` là object mới mỗi lần render, đặt nó làm phụ thuộc
  // thì memo tính lại y như không có memo.
  useEffect(() => {
    window.history.replaceState(null, "", listUrl);
  }, [listUrl]);

  const { data: page = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["customers", asked],
    queryFn: () => fetchCustomers(asked),
    // Giữ trang cũ trong lúc tải trang mới: không giữ thì bảng bị thay bằng
    // skeleton mỗi lần gõ, nút "Sau" rời khỏi DOM và người dùng bàn phím mất
    // tiêu điểm giữa chừng (AGENTS.md §8).
    placeholderData: keepPreviousData,
    // Nhiều người cùng nhập khách — bảng tự tải lại để thấy dòng đồng nghiệp
    // vừa thêm. Mặc định toàn app tắt refetch khi quay lại cửa sổ, màn này bật.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  /** Đổi bộ lọc thì về trang đầu — giữ nguyên trang 5 của kết quả cũ là hiện một khúc rỗng. */
  const refine = (patch: Partial<CustomerQuery>) => setQuery((q) => ({ ...q, ...patch, page: 0 }));

  const activeCount =
    (query.channelId ? 1 : 0) +
    (query.channelDetail ? 1 : 0) +
    (query.departmentId ? 1 : 0) +
    (query.staffId ? 1 : 0) +
    (from && to ? 1 : 0);
  // "Chưa có khách nào" và "lọc không ra gì" là hai chuyện khác nhau. Nói nhầm
  // thì người dùng đi xoá bộ lọc vốn đang trống, thay vì bấm "Thêm khách hàng".
  const filtering = Boolean(debouncedSearch) || activeCount > 0;

  /** Bảng có nửa cột Điểm hay không — theo việc người xem đã chọn khoảng ngày. */
  const showPoints = Boolean(range?.from && range.to);

  const columns = useMemo<RankColumn<CustomerRow>[]>(() => {
    /**
     * Phạm vi sửa hồ sơ khách, tính một lần cho cả bảng. `recordVisibility` đã
     * gọi `can()` bên trong và trả `none` khi không có quyền, nên từng dòng chỉ
     * cần hỏi `recordInScope`, không cần kiểm hai lớp.
     */
    const editScope = recordVisibility(user, "customer", "update");
    const deleteScope = recordVisibility(user, "customer", "delete");

    return [
      {
        key: "created",
        label: "Ngày tạo",
        sortable: true,
        render: (c) => <span className="tabular-nums">{formatDate(c.createdAt)}</span>,
      },
      {
        key: "name",
        label: "Tên khách hàng",
        sortable: true,
        render: (c) => (
          <Link href={`/customers/${c.id}`} className={styles.nameLink}>
            {c.fullName}
          </Link>
        ),
      },
      {
        key: "accounts",
        // Nửa "Điểm" chỉ có khi người xem đã chọn khoảng ngày: luật điểm là luật
        // của một tháng, chưa lọc thì không có tháng nào để chọn file luật.
        label: showPoints ? "Số tài khoản / Điểm" : "Số tài khoản",
        // Sắp theo số tài khoản, không sắp theo điểm: `CUSTOMER_SORT` chỉ có
        // khoá `accounts`, mà điểm nằm ngoài bảng `customers` nên đưa vào
        // `ORDER BY` là phải gộp cả kho trước khi cắt trang (AGENTS.md §5.2).
        sortable: true,
        // Hai số đo hai mốc: `accountCount` là tổng từ trước tới giờ, `points`
        // chỉ tính tài khoản mở trong tháng của bộ lọc.
        render: (c) => (
          <span className="tabular-nums">
            {c.accountCount}
            {c.points === null ? "" : ` / ${formatPoints(c.points)}`}
          </span>
        ),
      },
      {
        key: "insurance",
        label: "Số đơn BH",
        sortable: true,
        render: (c) => <span className="tabular-nums">{c.insuranceCount}</span>,
      },
      {
        key: "channel",
        label: "Kênh",
        render: (c) => c.channel || "",
      },
      {
        key: "createdByName",
        label: "Người tạo - Phòng",
        // Thiếu một trong hai vế thì bỏ luôn dấu nối, không để chuỗi treo đầu
        // hoặc treo đuôi.
        render: (c) => [c.createdByName, c.createdByDepartmentName].filter(Boolean).join(" - "),
      },
      {
        key: "actions",
        label: "Thao tác",
        render: (c) => (
          <span className={styles.actions}>
            <Button
              variant="secondary"
              disabled={c.giftStatus === "given"}
              onClick={() => setGivingGiftTo(c)}
            >
              <Gift size={16} />
              Tặng quà
            </Button>
            <Button
              variant="secondary"
              disabled={c.bankSlotsLeft <= 0}
              onClick={() => setOpeningBankFor(c)}
            >
              <Landmark size={16} />
              Mở ngân hàng
            </Button>
            <Button variant="secondary" onClick={() => setLoggingServiceFor(c)}>
              <Briefcase size={16} />
              Ghi dịch vụ
            </Button>
            {/* Phạm vi mức DÒNG, không phải `can()` mức module: quản lý thấy
                khách của cả công ty nhưng chỉ sửa được khách phòng mình quản.
                Cùng hàm với máy chủ ở `updateCustomer` (AGENTS.md §6). */}
            {recordInScope(editScope, c) && (
              <Button
                variant="secondary"
                icon
                tooltip="Sửa khách hàng"
                aria-label={`Sửa khách hàng ${c.fullName}`}
                onClick={() => setEditingId(c.id)}
              >
                <Pencil size={16} aria-hidden />
              </Button>
            )}
            {/* Nút KHÔNG khoá theo số tài khoản hiện trên dòng: con số đó đã lọc
                theo phạm vi người xem, nên người thấy 0 vẫn có thể đang xem một
                khách có tài khoản của phòng khác. Máy chủ quyết, và trả về câu
                nói rõ vướng gì. */}
            {recordInScope(deleteScope, c) && (
              <Button
                variant="secondary"
                icon
                tooltip="Xoá hồ sơ khách"
                aria-label={`Xoá hồ sơ khách ${c.fullName}`}
                onClick={() => setDeletingCustomer(c)}
              >
                <Trash2 size={16} aria-hidden />
              </Button>
            )}
          </span>
        ),
      },
    ];
  }, [user, showPoints]);

  return (
    <>
      <TopBar title="Khách hàng">
        <SearchField
          label="Tìm khách hàng"
          placeholder="Tên, SĐT, hoặc 4 số cuối CCCD…"
          value={search}
          onChange={(v) => {
            // Về trang đầu ngay lúc gõ, không đợi hoãn xong: đang ở trang 3 mà
            // kết quả mới chỉ có 2 dòng thì trang 3 là một khúc rỗng.
            setSearch(v);
            setQuery((q) => ({ ...q, page: 0 }));
          }}
        />
        <FilterButton
          activeCount={activeCount}
          onClear={() => {
            setRange(undefined);
            refine({ channelId: "", channelDetail: "", departmentId: "", staffId: "" });
          }}
        >
          <DateRangePicker
            label="Khoảng ngày"
            value={range}
            // Cột Điểm đọc tháng từ ngày đầu khoảng, mà luật điểm là luật của
            // MỘT tháng — khoảng vắt hai tháng thì không có file luật nào đúng.
            sameMonthOnly
            onChange={(next) => {
              setRange(next);
              setQuery((q) => ({ ...q, page: 0 }));
            }}
          />
          {canFilterByDepartment && (
            <Select
              block
              label="Phòng"
              value={query.departmentId}
              onChange={(v) => refine({ departmentId: v })}
              options={[{ value: "", label: "Tất cả phòng" }, ...departmentOptions]}
            />
          )}
          <Select
            block
            label="Kênh"
            value={query.channelId}
            // Đổi kênh thì bỏ luôn bệnh viện đã chọn — giữ lại là lọc một bệnh
            // viện trong một kênh không có bệnh viện nào, bảng ra rỗng.
            onChange={(v) => refine({ channelId: v, channelDetail: "" })}
            options={[
              { value: "", label: "Tất cả kênh" },
              ...channels.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          {channelTakesHospital && (
            <Combobox
              block
              // Combobox chứ không phải Select: danh mục bệnh viện dài dần theo
              // từng đợt mở kênh, mà `<select>` gốc không gõ tìm được.
              label="Bệnh viện"
              placeholder="Gõ để tìm bệnh viện…"
              value={query.channelDetail}
              onChange={(v) => refine({ channelDetail: v })}
              options={[
                { value: "", label: "Tất cả bệnh viện" },
                // Giá trị là TÊN, không phải id: cột `channelDetail` lưu tên.
                ...hospitals.map((h) => ({ value: h.name, label: h.name })),
              ]}
            />
          )}
          {canFilterByStaff && (
            <Combobox
              block
              // Combobox chứ không phải Select: công ty có hàng trăm nhân viên,
              // mà `<select>` gốc không gõ tìm được.
              label="Nhân viên"
              placeholder="Gõ để tìm nhân viên…"
              value={query.staffId}
              onChange={(v) => refine({ staffId: v })}
              options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
            />
          )}
        </FilterButton>
        {can(user, "customer", "create") && (
          <Button aria-label="Thêm khách hàng" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Thêm khách hàng</span>
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(from && to
              ? [
                  {
                    label: `Ngày tạo: ${formatDate(from)} → ${formatDate(to)}`,
                    onRemove: () => {
                      setRange(undefined);
                      setQuery((q) => ({ ...q, page: 0 }));
                    },
                  },
                ]
              : []),
            ...(query.departmentId
              ? [
                  {
                    label: `Phòng: ${departmentOptions.find((o) => o.value === query.departmentId)?.label ?? ""}`,
                    onRemove: () => refine({ departmentId: "" }),
                  },
                ]
              : []),
            ...(query.channelId
              ? [
                  {
                    label: `Kênh: ${channels.find((c) => c.id === query.channelId)?.name ?? query.channelId}`,
                    onRemove: () => refine({ channelId: "", channelDetail: "" }),
                  },
                ]
              : []),
            ...(query.channelDetail
              ? [
                  {
                    label: `Bệnh viện: ${query.channelDetail}`,
                    onRemove: () => refine({ channelDetail: "" }),
                  },
                ]
              : []),
            ...(query.staffId
              ? [
                  {
                    label: `Nhân viên: ${staffOptions.find((o) => o.value === query.staffId)?.label ?? ""}`,
                    onRemove: () => refine({ staffId: "" }),
                  },
                ]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={8} />}
        {isError && (
          <ErrorState what="danh sách khách hàng" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <SectionCard
            title="Khách hàng"
            icon={<Users size={17} />}
            meta={filtering ? `khớp ${page.total}` : `${page.total} khách`}
          >
            {page.total === 0 ? (
              <p className="text-muted">
                {debouncedSearch
                  ? `Không tìm thấy khách nào khớp “${debouncedSearch}”.`
                  : filtering
                    ? "Không có khách nào khớp bộ lọc."
                    : "Chưa có khách hàng nào."}
              </p>
            ) : (
              <RankTable
                rows={page.rows}
                columns={columns}
                rowKey={(c) => c.id}
                defaultSort="created"
                caption="Khách hàng, số tài khoản, số đơn bảo hiểm và trạng thái quà"
                server={{
                  sort: query.sort,
                  dir: query.dir,
                  page: query.page,
                  total: page.total,
                  pageSize: PAGE_SIZE,
                  onSortChange: (sort, dir) =>
                    refine({ sort: sort as CustomerQuery["sort"], dir }),
                  onPageChange: (next) => setQuery((q) => ({ ...q, page: next })),
                }}
              />
            )}
          </SectionCard>
        )}

        {creating && <CustomerFormDialog open onClose={() => setCreating(false)} />}

        {editingId && <EditCustomerDialog id={editingId} onClose={() => setEditingId(null)} />}

        {givingGiftTo && (
          <GiftGivingDialog
            open
            customerId={givingGiftTo.id}
            customerName={givingGiftTo.fullName}
            onClose={() => setGivingGiftTo(null)}
          />
        )}

        {openingBankFor && (
          <BankAccountFormDialog
            open
            customerId={openingBankFor.id}
            customerDepartmentId={openingBankFor.createdByDepartmentId}
            onClose={() => setOpeningBankFor(null)}
          />
        )}

        {loggingServiceFor && (
          <ServiceFormDialog
            open
            customerId={loggingServiceFor.id}
            customerName={loggingServiceFor.fullName}
            customerDepartmentId={loggingServiceFor.createdByDepartmentId}
            onClose={() => setLoggingServiceFor(null)}
          />
        )}

        {deletingCustomer && (
          <ConfirmDialog
            open
            title="Xoá hồ sơ khách"
            confirmLabel="Xoá hồ sơ"
            pending={removeCustomer.isPending}
            onConfirm={() => removeCustomer.mutate(deletingCustomer.id)}
            onClose={() => setDeletingCustomer(null)}
          >
            Xoá hẳn hồ sơ của <strong>{deletingCustomer.fullName}</strong> cùng mọi số điện
            thoại của khách?
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}
