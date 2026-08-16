"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { BankAccountEditDialog } from "@/components/banking/BankAccountEditDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CreateBankAccountDialog } from "@/components/banking/CreateBankAccountDialog";
import { Button } from "@/components/ui/Button";
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
import { BankAccountStatus, deleteBankAccount } from "@/lib/api/bankAccounts";
import { fetchBankAccounts, fetchBankAccountsForExport, type BankAccountRow } from "@/lib/api/banking";
import { fetchBanks, fetchReferralCodeOptions } from "@/lib/api/bankCatalog";
import { fetchChannels } from "@/lib/api/channelCatalog";
import { fetchStaffOptions } from "@/lib/api/staff";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { exportExcel } from "@/lib/excel";
import { formatDate, formatPhone } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import { can } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const STATUS_LABEL: Record<BankAccountStatus, string> = {
  creating: "Đang tạo",
  done: "Hoàn thành",
};

/** Xuất Excel gộp theo khách — mỗi khách một dòng, một cột riêng cho mỗi ngân hàng (spec §8.2). */
function exportByCustomer(rows: BankAccountRow[], bankCodes: string[]) {
  // Khoá gộp là `customerId`, KHÔNG phải tên. Database đang có hai khách trùng
  // tên khác CCCD; gộp theo tên là trộn hồ sơ của hai người vào một dòng.
  //
  // Ô ngân hàng giữ TẬP số, không phải một chuỗi: gán đè thì khách có nhiều tài
  // khoản ở cùng ngân hàng chỉ còn số cuối. Một khách thật đang có 4 tài khoản
  // BIDV. `Set` cũng gộp luôn các số trùng nhau.
  const byCustomer = new Map<string, { customerName: string; createdByNames: Set<string>; cells: Record<string, Set<string>> }>();
  for (const r of rows) {
    const row = byCustomer.get(r.customerId) ?? {
      customerName: r.customerName,
      createdByNames: new Set<string>(),
      cells: {},
    };
    (row.cells[r.bankCode] ??= new Set<string>()).add(r.accountNumber);
    if (r.createdByName) row.createdByNames.add(r.createdByName);
    byCustomer.set(r.customerId, row);
  }

  return exportExcel({
    fileName: `tai-khoan-ngan-hang-${iso(new Date())}.xlsx`,
    sheetName: "Tài khoản ngân hàng",
    rows: [...byCustomer.values()],
    columns: [
      { header: "Khách hàng", transform: "name", value: (r) => r.customerName },
      { header: "Người tạo", value: (r) => [...r.createdByNames].join(", ") },
      ...bankCodes.map((code) => ({
        header: code,
        type: "text" as const,
        value: (r: { cells: Record<string, Set<string>> }) => [...(r.cells[code] ?? [])].join(", "),
      })),
    ],
  });
}

/** P-21 · Danh sách tài khoản ngân hàng. */
export default function BankingPage() {
  const user = useSession((s) => s.user);
  const [search, setSearch] = useState("");
  const searchQuery = useDebouncedValue(search);
  const [bankCode, setBankCode] = useState("");
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [referralCode, setReferralCode] = useState("");
  const [channelId, setChannelId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [status, setStatus] = useState<BankAccountStatus | "">("");
  const [page, setPage] = useState(0);
  // Chỉ sắp theo ngày mở, và chỉ đổi được chiều — sắp theo tên khách thì phải
  // nối bảng trước khi cắt trang, trên bảng lớn nhất hệ thống.
  const [dir, setDir] = useState<SortDir>("desc");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BankAccountRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const { data: codes = [] } = useQuery({
    queryKey: ["referral-code-options"],
    queryFn: fetchReferralCodeOptions,
  });
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  /**
   * Ô lọc "Nhân viên" đọc TRỌN danh sách, không gom từ các dòng đang hiện.
   *
   * Gom từ dòng thì ô chọn chỉ có những người tình cờ nằm ở trang đang xem —
   * lọc theo người thứ 16 trở đi là không chọn được.
   */
  const { data: staff = [] } = useQuery({
    queryKey: ["staff", "options", "active"],
    queryFn: () => fetchStaffOptions({ status: "active" }),
    retry: false,
    staleTime: Infinity,
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

  const filters = {
    search: searchQuery,
    bankCode,
    from,
    to,
    referralCode,
    channelId,
    staffId,
    status,
  };

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["bank-account-list", filters, page, dir],
    queryFn: () => fetchBankAccounts({ ...filters, page, sort: "date", dir }),
    placeholderData: keepPreviousData,
  });

  /**
   * Xuất Excel đi qua đường RIÊNG, không dựng file từ trang đang xem.
   *
   * Dựng từ `data.rows` thì file chỉ có 15 dòng của trang hiện tại mà trông y
   * hệt file đầy đủ — người nhận không có cách nào biết.
   */
  const exportAll = async () => {
    setExporting(true);
    try {
      const { rows, total } = await fetchBankAccountsForExport(filters);
      if (rows.length < total) {
        throw new Error(
          `Bộ lọc này có ${total.toLocaleString("vi-VN")} tài khoản, vượt trần ${rows.length.toLocaleString("vi-VN")} dòng một lần xuất. Thu hẹp khoảng ngày rồi xuất làm nhiều đợt.`,
        );
      }
      await exportByCustomer(rows, banks.map((b) => b.code));
      toast.ok(`Đã xuất ${rows.length.toLocaleString("vi-VN")} tài khoản`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };

  const activeCount =
    (bankCode ? 1 : 0) +
    (from && to ? 1 : 0) +
    (referralCode ? 1 : 0) +
    (channelId ? 1 : 0) +
    (staffId ? 1 : 0) +
    (status ? 1 : 0);

  const columns = useMemo<RankColumn<BankAccountRow>[]>(
    () => [
      {
        key: "date",
        label: "Ngày",
        sortable: true,
        render: (r) => (r.date ? formatDate(r.date) : "—"),
      },
      {
        key: "customerName",
        label: "Khách hàng",
        render: (r) => (
          <Link href={`/banking/${r.id}`} className={styles.nameLink}>
            {r.customerName}
          </Link>
        ),
      },
      { key: "bankCode", label: "Ngân hàng", render: (r) => r.bankCode },
      {
        key: "accountNumber",
        label: "STK",
        render: (r) => <span className="tabular-nums">{formatPhone(r.accountNumber)}</span>,
      },
      { key: "referralCode", label: "Mã giới thiệu", render: (r) => r.referralCode },
      {
        key: "status",
        label: "Trạng thái",
        render: (r) => (
          <StatusTag ok={r.status === "done"}>{STATUS_LABEL[r.status]}</StatusTag>
        ),
      },
      {
        key: "appInstalled",
        label: "Đã cài app",
        render: (r) => <StatusTag ok={r.appInstalled}>{r.appInstalled ? "Có" : "Không"}</StatusTag>,
      },
      { key: "createdByName", label: "Người tạo", render: (r) => r.createdByName ?? "—" },
      ...(canWrite || canRemove
        ? [{
        key: "actions",
        label: "Thao tác",
        // Nút chỉ có icon nên `aria-label` phải kèm tên khách: giữa mười lăm
        // dòng giống nhau, "Sửa" một mình không nói đang sửa dòng nào.
        render: (r: BankAccountRow) => (
          <RowActions>
            {canWrite && (
              <Button
                variant="secondary"
                icon
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
              setReferralCode("");
              setChannelId("");
              setStaffId("");
              setStatus("");
            })
          }
        >
          <Select
            label="Ngân hàng"
            value={bankCode}
            onChange={(v) => refine(() => setBankCode(v))}
            options={[
              { value: "", label: "Tất cả ngân hàng" },
              ...banks.map((b) => ({ value: b.code, label: b.code })),
            ]}
          />
          <Select
            label="Trạng thái"
            value={status}
            onChange={(v) => refine(() => setStatus(v as BankAccountStatus | ""))}
            options={[
              { value: "", label: "Tất cả trạng thái" },
              ...BankAccountStatus.options.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            ]}
          />
          <DateRangePicker value={range} onChange={(v) => refine(() => setRange(v))} />
          <Select
            label="Mã giới thiệu"
            value={referralCode}
            onChange={(v) => refine(() => setReferralCode(v))}
            options={[
              { value: "", label: "Tất cả mã giới thiệu" },
              ...codes.map((code) => ({ value: code, label: code })),
            ]}
          />
          <Select
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
            label="Nhân viên"
            value={staffId}
            onChange={(v) => refine(() => setStaffId(v))}
            options={[{ value: "", label: "Tất cả nhân viên" }, ...staffOptions]}
          />
          {can(user, "banking", "export") && (
            <Button
              variant="secondary"
              block
              onClick={exportAll}
              disabled={exporting || data.total === 0}
            >
              <Download size={16} aria-hidden />
              Xuất Excel
            </Button>
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
            ...(bankCode ? [{ label: `Ngân hàng: ${bankCode}`, onRemove: () => refine(() => setBankCode("")) }] : []),
            ...(from && to
              ? [{ label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`, onRemove: () => refine(() => setRange(undefined)) }]
              : []),
            ...(referralCode
              ? [{ label: `Mã giới thiệu: ${referralCode}`, onRemove: () => refine(() => setReferralCode("")) }]
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
