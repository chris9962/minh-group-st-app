"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, Gift } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  fetchGiftGrants,
  fetchGiftGrantsForExport,
  type GiftGrantRow,
} from "@/lib/api/gifts";
import { fetchDepartments } from "@/lib/api/departments";
import { fetchStaffOptions } from "@/lib/api/staff";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { exportExcel } from "@/lib/excel";
import { formatDate, formatVnd } from "@/lib/format";
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

/**
 * P-44 · Quà đã phát — nhìn ngang qua mọi khách.
 *
 * Màn CHỈ ĐỌC. Phát quà và đổi món vẫn nằm ở hồ sơ khách P-42/P-43, nơi người
 * bấm thấy đủ rổ quà, số app đã cài và lịch sử đổi.
 */
export default function GiftsPage() {
  const user = useSession((s) => s.user);
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const searchQuery = useDebouncedValue(search);
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = dateFromUrl(searchParams.get("from"));
    const to = dateFromUrl(searchParams.get("to"));
    return from || to ? { from, to } : undefined;
  });
  const [departmentId, setDepartmentId] = useState(() => searchParams.get("departmentId") ?? "");
  const [staffId, setStaffId] = useState(() => searchParams.get("staffId") ?? "");
  const [page, setPage] = useState(() => pageFromUrl(searchParams.get("page")));
  // Chỉ sắp theo ngày phát, và chỉ đổi được chiều — sắp theo tên khách thì phải
  // nối bảng trước khi cắt trang.
  const [dir, setDir] = useState<SortDir>(() =>
    searchParams.get("dir") === "asc" ? "asc" : "desc",
  );
  const [exporting, setExporting] = useState(false);

  /**
   * Ô lọc "Phòng" chỉ có nghĩa khi phạm vi đọc của người xem trải qua NHIỀU
   * phòng. Nhân viên chỉ thấy quà mình phát, còn trưởng phòng thì mọi dòng đã
   * cùng một phòng — ô lọc ra chính bảng đang xem.
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

  // Phạm vi 'own' thì bảng chỉ có quà của chính mình — ô lọc Nhân viên không có
  // ai khác để chọn, và lời gọi danh sách nhân viên chắc chắn 403.
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
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (departmentId) params.set("departmentId", departmentId);
    if (staffId) params.set("staffId", staffId);
    if (page > 0) params.set("page", String(page + 1));
    if (dir === "asc") params.set("dir", dir);
    const query = params.toString();
    return query ? `/gifts?${query}` : "/gifts";
  }, [departmentId, dir, from, page, searchQuery, staffId, to]);

  useEffect(() => {
    window.history.replaceState(null, "", listUrl);
  }, [listUrl]);

  const filters = { search: searchQuery, from, to, departmentId, staffId };

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["gift-grants", filters, page, dir],
    queryFn: () => fetchGiftGrants({ ...filters, page, sort: "date", dir }),
    placeholderData: keepPreviousData,
  });

  const activeCount = (from && to ? 1 : 0) + (departmentId ? 1 : 0) + (staffId ? 1 : 0);

  /**
   * Xuất Excel đi qua đường RIÊNG, không dựng file từ trang đang xem.
   *
   * Dựng từ `data.rows` thì file chỉ có 15 dòng của trang hiện tại mà trông y
   * hệt file đầy đủ — người nhận không có cách nào biết.
   */
  const exportAll = async () => {
    setExporting(true);
    try {
      const { rows, total } = await fetchGiftGrantsForExport(filters);
      if (rows.length < total) {
        throw new Error(
          `Bộ lọc này có ${total.toLocaleString("vi-VN")} đợt quà, vượt trần ${rows.length.toLocaleString("vi-VN")} dòng của một lượt xuất. Thu hẹp khoảng ngày rồi xuất làm nhiều đợt.`,
        );
      }
      await exportExcel({
        fileName: `qua-da-phat-${iso(new Date())}.xlsx`,
        sheetName: "Quà đã phát",
        rows,
        columns: [
          { header: "Ngày phát", value: (r) => formatDate(r.date) },
          { header: "Khách hàng", transform: "name", value: (r) => r.customerName },
          { header: "Món quà", value: (r) => r.item },
          { header: "Tiền mặt", type: "number", value: (r) => r.cashTotal },
          // MÃ nhân viên chứ không phải tên: file này đem đối chiếu với app khác
          // của công ty, mà app đó định danh theo mã.
          { header: "Mã NV", type: "text", value: (r) => r.grantedByStaffCode },
          { header: "Phòng", value: (r) => r.grantedByDepartmentName ?? "" },
        ],
      });
      toast.ok(`Đã xuất ${rows.length.toLocaleString("vi-VN")} đợt quà`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo<RankColumn<GiftGrantRow>[]>(
    () => [
      { key: "date", label: "Ngày phát", sortable: true, render: (r) => formatDate(r.date) },
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
        key: "item",
        label: "Món quà",
        // Từ chối nhận quà cũng là một kết quả đã chốt, không phải dòng hỏng —
        // nhãn nói rõ để người đọc không tưởng dữ liệu thiếu.
        render: (r) => (r.declined ? <StatusTag tone="waiting">{r.item}</StatusTag> : r.item),
      },
      {
        key: "cashTotal",
        label: "Tiền mặt",
        render: (r) => <span className="tabular-nums">{formatVnd(r.cashTotal)}</span>,
      },
      {
        key: "grantedBy",
        label: "Người phát",
        /*
          Mã nhân viên chứ không phải tên: app khác của công ty định danh theo
          mã, mà người đối chiếu hai bên ngồi ngay trên bảng này. Chưa gán mã
          thì hiện tên — ô trống không nói được ai đã phát.
        */
        render: (r) =>
          [r.grantedByStaffCode || r.grantedByName, r.grantedByDepartmentName]
            .filter(Boolean)
            .join(" - ") || "—",
      },
    ],
    [],
  );

  return (
    <>
      <TopBar title="Quà đã phát">
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
              setRange(undefined);
              setDepartmentId("");
              setStaffId("");
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
          {can(user, "banking", "export") && (
            <Button variant="secondary" block onClick={exportAll} disabled={exporting || data.total === 0}>
              <Download size={16} aria-hidden />
              Xuất Excel
            </Button>
          )}
        </FilterButton>
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

        {isPending && <SkeletonTable rows={8} columns={5} />}
        {isError && <ErrorState what="danh sách quà đã phát" onRetry={refetch} retrying={isFetching} />}

        {!isPending && !isError && (
          <SectionCard title="Quà đã phát" icon={<Gift size={17} />} meta={`${data.total} dòng`}>
            <RankTable
              rows={data.rows}
              columns={columns}
              rowKey={(r) => r.id}
              defaultSort="date"
              caption="Quà đã phát cho khách hàng"
              emptyText={
                activeCount > 0 || searchQuery
                  ? "Không có đợt quà nào khớp bộ lọc."
                  : "Chưa phát quà cho khách nào."
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
      </main>
    </>
  );
}
