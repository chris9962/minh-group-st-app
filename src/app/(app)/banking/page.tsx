"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountEditDialog } from "@/components/banking/BankAccountEditDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CreateBankAccountDialog } from "@/components/banking/CreateBankAccountDialog";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import buttonStyles from "@/components/ui/Button.module.css";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  ACCOUNT_TYPE_LABEL,
  AccountType,
  BANK_ACCOUNT_STATUS_LABEL as STATUS_LABEL,
  BankAccountStatus,
  deleteBankAccount,
} from "@/lib/api/bankAccounts";
import { fetchBankAccounts, type BankAccountRow } from "@/lib/api/banking";
import { fetchBanks } from "@/lib/api/bankCatalog";
import { fetchChannels } from "@/lib/api/channelCatalog";
import { fetchDepartments } from "@/lib/api/departments";
import { fetchStaffOptions } from "@/lib/api/staff";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { formatDate, formatPhone } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { can, recordVisibility, scopeFor } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { isRealIsoDate } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** URL chỉ nhận ngày có thật — `2026-02-31` không được thành tháng Ba mà không báo gì. */
const dateFromUrl = (value: string | null): Date | undefined =>
  value && isRealIsoDate(value) ? new Date(`${value}T00:00:00`) : undefined;

const pageFromUrl = (value: string | null): number => {
  const page = Number(value);
  // URL đếm từ 1 để người dùng đọc được; `RankTable` đếm từ 0 nội bộ.
  return Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0;
};

/** P-21 · Danh sách tài khoản ngân hàng. */
export default function BankingPage() {
  const user = useSession((s) => s.user);
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const searchQuery = useDebouncedValue(search);
  const [bankCode, setBankCode] = useState(() => searchParams.get("bankCode") ?? "");
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = dateFromUrl(searchParams.get("from"));
    const to = dateFromUrl(searchParams.get("to"));
    return from || to ? { from, to } : undefined;
  });
  const [departmentId, setDepartmentId] = useState(() => searchParams.get("departmentId") ?? "");
  const [channelId, setChannelId] = useState(() => searchParams.get("channelId") ?? "");
  const [staffId, setStaffId] = useState(() => searchParams.get("staffId") ?? "");
  const [status, setStatus] = useState<BankAccountStatus | "">(() => {
    const parsed = BankAccountStatus.safeParse(searchParams.get("status"));
    return parsed.success ? parsed.data : "";
  });
  const [accountType, setAccountType] = useState<AccountType | "">(() => {
    const parsed = AccountType.safeParse(searchParams.get("accountType"));
    return parsed.success ? parsed.data : "";
  });
  const [page, setPage] = useState(() => pageFromUrl(searchParams.get("page")));
  // Chỉ sắp theo ngày mở, và chỉ đổi được chiều — sắp theo tên khách thì phải
  // nối bảng trước khi cắt trang, trên bảng lớn nhất hệ thống.
  const [dir, setDir] = useState<SortDir>(() =>
    searchParams.get("dir") === "asc" ? "asc" : "desc",
  );
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BankAccountRow | null>(null);

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  /**
   * Ô lọc "Phòng" chỉ có nghĩa khi phạm vi đọc của người xem trải qua NHIỀU
   * phòng. Nhân viên chỉ thấy tài khoản mình mở, còn trưởng phòng thì mọi dòng
   * đã cùng một phòng — ô lọc ra chính bảng đang xem.
   */
  const canFilterByDepartment = useMemo(() => {
    const scope = recordVisibility(user, "banking", "view-detail");
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
    const scope = recordVisibility(user, "banking", "view-detail");
    const inScope =
      scope.kind === "departments"
        ? departments.filter((d) => scope.departmentIds.includes(d.id))
        : departments;
    return inScope.map((d) => ({ value: d.id, label: d.name }));
  }, [user, departments]);

  /**
   * Ô lọc "Nhân viên" đọc TRỌN danh sách, không gom từ các dòng đang hiện.
   *
   * Gom từ dòng thì ô chọn chỉ có những người tình cờ nằm ở trang đang xem —
   * lọc theo người thứ 16 trở đi là không chọn được. Hỏng thì để rỗng chứ không
   * chặn cả màn.
   */
  // Phạm vi 'own' thì bảng chỉ có tài khoản của chính mình — ô lọc Nhân viên
  // không có ai khác để chọn, và lời gọi danh sách nhân viên chắc chắn 403.
  const canFilterByStaff = scopeFor(user, "banking", "view-detail") !== "own";

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

  /** Đổi bộ lọc thì về trang đầu — giữ trang 5 của kết quả cũ là hiện khúc rỗng. */
  const refine = (apply: () => void) => {
    apply();
    setPage(0);
  };

  const canWrite = can(user, "banking", "update");
  const canRemove = can(user, "banking", "delete");

  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (row: BankAccountRow) => deleteBankAccount(row.id),
    onSuccess: (_void, row) => {
      queryClient.invalidateQueries({ queryKey: ["bank-account-list"] });
      // Xoá bản nháp là NHẢ CHỖ mã về kho — ô chọn mã ở hộp thoại mở tài khoản
      // phải thấy số mới ngay, không đợi hết staleTime.
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customer", row.customerId] });
      setRemoving(null);
      // Lùi TRƯỚC khi gọi lại: chỗ này biết trang vừa mất dòng cuối, `RankTable`
      // thì chỉ biết sau khi máy chủ đã trả về một trang rỗng. Bỏ dòng này thì
      // người dùng thấy chữ "Chưa có tài khoản nào" suốt một lượt gọi mạng.
      setPage((p) => (data.rows.length === 1 && p > 0 ? p - 1 : p));
      toast.ok("Đã xoá tài khoản đang tạo dở, mã giới thiệu được nhả lại");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được tài khoản này.")),
  });

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  /**
   * Danh sách là một trạng thái quay lại và chia sẻ được, nên mọi thứ làm đổi
   * kết quả đều nằm trên URL. `replaceState` không thêm một mục lịch sử theo
   * từng ký tự gõ.
   */
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (bankCode) params.set("bankCode", bankCode);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (departmentId) params.set("departmentId", departmentId);
    if (channelId) params.set("channelId", channelId);
    if (staffId) params.set("staffId", staffId);
    if (status) params.set("status", status);
    if (accountType) params.set("accountType", accountType);
    if (page > 0) params.set("page", String(page + 1));
    if (dir === "asc") params.set("dir", dir);
    const query = params.toString();
    return query ? `/banking?${query}` : "/banking";
  }, [accountType, bankCode, channelId, departmentId, dir, from, page, searchQuery, staffId, status, to]);

  useEffect(() => {
    window.history.replaceState(null, "", listUrl);
  }, [listUrl]);

  const filters = {
    search: searchQuery,
    bankCode,
    from,
    to,
    // Trang này bỏ ô lọc theo mã (chốt 2026-09-03): trang chi tiết ngân hàng đã
    // lọc theo mã, và ở đó ô chọn đi bằng id nên mã QR-only cũng chọn được.
    referralCode: "",
    channelId,
    staffId,
    departmentId,
    status,
    accountType,
  };

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["bank-account-list", filters, page, dir],
    queryFn: () => fetchBankAccounts({ ...filters, page, sort: "date", dir }),
    placeholderData: keepPreviousData,
  });

  const activeCount =
    (bankCode ? 1 : 0) +
    (from && to ? 1 : 0) +
    (departmentId ? 1 : 0) +
    (channelId ? 1 : 0) +
    (staffId ? 1 : 0) +
    (status ? 1 : 0) +
    (accountType ? 1 : 0);

  const columns = useMemo<RankColumn<BankAccountRow>[]>(
    () => [
      {
        key: "date",
        label: "Ngày",
        sortable: true,
        render: (r) => (r.date ? formatDate(r.date) : "—"),
      },
      {
        key: "bankCode",
        label: "Ngân hàng",
        render: (r) => (
          <Link href={`/banking/${r.id}`} className={styles.nameLink}>
            {r.accountType === "none" ? r.bankCode : `${r.bankCode} - ${ACCOUNT_TYPE_LABEL[r.accountType]}`}
          </Link>
        ),
      },
      {
        key: "customerName",
        label: "Khách hàng",
        render: (r) => (
          <Link href={`/customers/${r.customerId}`} className={styles.nameLink}>
            {r.customerName}
          </Link>
        ),
      },
      {
        key: "accountNumber",
        label: "STK",
        render: (r) => <span className="tabular-nums">{formatPhone(r.accountNumber)}</span>,
      },
      { key: "department", label: "Phòng", render: (r) => r.createdByDepartmentName ?? "—" },
      {
        key: "status",
        label: "Trạng thái",
        render: (r) => (
          <StatusTag tone={r.status === "done" ? "ok" : r.status === "error" ? "warn" : "waiting"}>
            {STATUS_LABEL[r.status]}
          </StatusTag>
        ),
      },
      {
        key: "appInstalled",
        label: "Đã cài app",
        render: (r) => <StatusTag ok={r.appInstalled}>{r.appInstalled ? "Có" : "Không"}</StatusTag>,
      },
      {
        key: "createdByName",
        label: "Người tạo",
        /*
          Mã nhân viên chứ không phải tên: app khác của công ty định danh theo
          mã, mà người đối chiếu hai bên ngồi ngay trên bảng này. Chưa gán mã
          thì hiện tên — ô trống không nói được ai đã tạo dòng đó.
        */
        render: (r) =>
          [r.createdByStaffCode || r.createdByName, r.createdByDepartmentName]
            .filter(Boolean)
            .join(" - ") || "—",
      },
      ...(canWrite || canRemove
        ? [{
        key: "actions",
        label: "Thao tác",
        // Nút chỉ có icon nên `aria-label` phải kèm tên khách: giữa mười lăm
        // dòng giống nhau, "Sửa" một mình không nói đang sửa dòng nào.
        render: (r: BankAccountRow) => (
          <RowActions>
            {canWrite && r.status !== "error" && (
              <Button
                variant="secondary"
                icon
                tooltip={r.status === "creating" ? "Hoàn tất tài khoản" : "Ảnh chứng minh"}
                aria-label={
                  r.status === "creating"
                    ? `Hoàn tất tài khoản ${r.bankCode} của ${r.customerName}`
                    : `Ảnh chứng minh tài khoản ${r.bankCode} của ${r.customerName}`
                }
                onClick={() => setEditingId(r.id)}
              >
                <Pencil size={16} aria-hidden />
              </Button>
            )}
            {/* Chỉ bản NHÁP mới xoá được (spec §4.5): tài khoản đã hoàn thành
                đã tiêu một lượt mã và đã vào điểm KPI. Ẩn nút thay vì hiện rồi
                báo lỗi — nút bấm không làm gì là lời hứa suông. */}
            {canRemove && r.status === "creating" && (
              <Button
                variant="secondary"
                icon
                tooltip="Xoá tài khoản"
                aria-label={`Xoá tài khoản ${r.bankCode} đang tạo dở của ${r.customerName}`}
                onClick={() => setRemoving(r)}
              >
                <Trash2 size={16} aria-hidden />
              </Button>
            )}
          </RowActions>
        ),
      }]
        : []),
    ],
    [canWrite, canRemove],
  );

  return (
    <>
      <TopBar title="Ngân hàng">
        <SearchField
          label="Tìm khách hàng"
          placeholder="Tìm tên khách hàng…"
          value={search}
          onChange={(v) => {
            // Về trang đầu ngay lúc gõ, không đợi hoãn xong: đang ở trang 3 mà
            // kết quả mới chỉ có 2 dòng thì trang 3 là một khúc rỗng.
            setSearch(v);
            setPage(0);
          }}
        />
        <FilterButton
          activeCount={activeCount}
          onClear={() =>
            refine(() => {
              setBankCode("");
              setRange(undefined);
              setDepartmentId("");
              setChannelId("");
              setStaffId("");
              setStatus("");
              setAccountType("");
            })
          }
        >
          <DateRangePicker label="Khoảng ngày" value={range} onChange={(v) => refine(() => setRange(v))} />
          {canFilterByDepartment && (
            <Select
              block
              label="Phòng"
              value={departmentId}
              onChange={(v) => refine(() => setDepartmentId(v))}
              options={[{ value: "", label: "Tất cả phòng" }, ...departmentOptions]}
            />
          )}
          <Select
            block
            label="Ngân hàng"
            value={bankCode}
            onChange={(v) => refine(() => setBankCode(v))}
            options={[
              { value: "", label: "Tất cả ngân hàng" },
              ...banks.map((b) => ({ value: b.code, label: b.code })),
            ]}
          />
          <Select
            block
            label="Loại TK"
            value={accountType}
            onChange={(v) => refine(() => setAccountType(v as AccountType | ""))}
            options={[
              { value: "", label: "Tất cả loại" },
              ...AccountType.options.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] })),
            ]}
          />
          <Select
            block
            label="Kênh"
            value={channelId}
            onChange={(v) => refine(() => setChannelId(v))}
            options={[
              { value: "", label: "Tất cả kênh" },
              // Lọc theo ID kênh, không theo tên: kênh đổi tên thì lọc theo
              // tên bỏ sót đúng những dòng cũ cần tìm.
              ...channels.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            block
            label="Trạng thái"
            value={status}
            onChange={(v) => refine(() => setStatus(v as BankAccountStatus | ""))}
            options={[
              { value: "", label: "Tất cả trạng thái" },
              ...BankAccountStatus.options.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            ]}
          />
          {canFilterByStaff && (
            <Combobox
              block
              // Combobox chứ không phải Select: công ty có hàng trăm nhân viên,
              // mà `<select>` gốc không gõ tìm được.
              label="Nhân viên"
              placeholder="Gõ để tìm nhân viên…"
              value={staffId}
              onChange={(v) => refine(() => setStaffId(v))}
              options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
            />
          )}
        </FilterButton>
        {can(user, "banking", "create") && (
          <Button aria-label="Tạo tài khoản ngân hàng" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            <span className={buttonStyles.label}>Tạo tài khoản ngân hàng</span>
          </Button>
        )}
      </TopBar>

      <main className={styles.body}>
        <FilterChips
          chips={[
            ...(from && to
              ? [{ label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`, onRemove: () => refine(() => setRange(undefined)) }]
              : []),
            ...(departmentId
              ? [
                  {
                    label: `Phòng: ${departmentOptions.find((o) => o.value === departmentId)?.label ?? ""}`,
                    onRemove: () => refine(() => setDepartmentId("")),
                  },
                ]
              : []),
            ...(bankCode ? [{ label: `Ngân hàng: ${bankCode}`, onRemove: () => refine(() => setBankCode("")) }] : []),
            ...(accountType
              ? [
                  {
                    label: `Loại TK: ${ACCOUNT_TYPE_LABEL[accountType]}`,
                    onRemove: () => refine(() => setAccountType("")),
                  },
                ]
              : []),
            ...(channelId
              ? [
                  {
                    label: `Kênh: ${channels.find((c) => c.id === channelId)?.name ?? ""}`,
                    onRemove: () => refine(() => setChannelId("")),
                  },
                ]
              : []),
            ...(status
              ? [{ label: `Trạng thái: ${STATUS_LABEL[status]}`, onRemove: () => refine(() => setStatus("")) }]
              : []),
            ...(staffId
              ? [
                  {
                    label: `Nhân viên: ${staffOptions.find((s) => s.value === staffId)?.label ?? ""}`,
                    onRemove: () => refine(() => setStaffId("")),
                  },
                ]
              : []),
          ]}
        />

        {isPending && <SkeletonTable rows={8} columns={6} />}
        {isError && (
          <ErrorState what="danh sách tài khoản" onRetry={refetch} retrying={isFetching} />
        )}

        {!isPending && !isError && (
          <SectionCard
            title="Tài khoản ngân hàng"
            icon={<Landmark size={17} />}
            meta={`${data.total} dòng`}
          >
            <RankTable
              rows={data.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort="date"
              caption="Tài khoản ngân hàng đã mở cho khách hàng"
              emptyText={
                activeCount > 0 || searchQuery
                  ? "Không có tài khoản nào khớp bộ lọc."
                  : "Chưa mở tài khoản nào."
              }
              server={{
                sort: "date",
                dir,
                page,
                total: data.total,
                pageSize: PAGE_SIZE,
                onSortChange: (_sort, nextDir) => {
                  setDir(nextDir);
                  setPage(0);
                },
                onPageChange: setPage,
              }}
            />
          </SectionCard>
        )}

        {creating && <CreateBankAccountDialog open onClose={() => setCreating(false)} />}
        {editingId && (
          <BankAccountEditDialog
            open
            accountId={editingId}
            onClose={() => setEditingId(null)}
          />
        )}
        {removing && (
          <ConfirmDialog
            open
            title="Xoá tài khoản đang tạo dở?"
            consequence="Chỗ đang giữ trên mã giới thiệu được nhả lại kho ngay. Ảnh đã tải lên cũng mất theo."
            confirmLabel="Xoá"
            pending={remove.isPending}
            onConfirm={() => remove.mutate(removing)}
            onClose={() => setRemoving(null)}
          >
            Tài khoản <strong>{removing.bankCode}</strong> của {removing.customerName}, mã{" "}
            {removing.referralCode}.
          </ConfirmDialog>
        )}
      </main>
    </>
  );
}
