"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Download, Landmark } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { BankPhotoGallery } from "@/components/banking/BankPhotoGallery";
import { Button } from "@/components/ui/Button";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { Combobox } from "@/components/ui/Combobox";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { ErrorState } from "@/components/ui/ErrorState";
import { FilterButton } from "@/components/ui/FilterButton";
import { FilterChips } from "@/components/ui/FilterChips";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  ACCOUNT_TYPE_LABEL,
  BANK_ACCOUNT_STATUS_LABEL,
  BankAccountStatus,
} from "@/lib/api/bankAccounts";
import { fetchBankReferralCodeOptions, fetchBanks } from "@/lib/api/bankCatalog";
import { fetchDepartments } from "@/lib/api/departments";
import {
  fetchBankAccountsOfBank,
  fetchBankAccountsOfBankForExport,
  type BankAccountRow,
} from "@/lib/api/banking";
import { EMPTY_PAGE, PAGE_SIZE, type SortDir } from "@/lib/api/pagination";
import { exportExcel } from "@/lib/excel";
import { formatDate, formatPhone } from "@/lib/format";
import { canManageBank, canOpenBankAdmin } from "@/lib/permissions";
import { errorMessage, toast } from "@/lib/toast";
import { isRealIsoDate } from "@/lib/types";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

const iso = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** URL chỉ nhận ngày có thật — `2026-02-31` không được biến thành tháng Ba. */
const dateFromUrl = (value: string | null): Date | undefined =>
  value && isRealIsoDate(value) ? new Date(`${value}T00:00:00`) : undefined;

const pageFromUrl = (value: string | null): number => {
  const page = Number(value);
  // URL đếm từ 1 để người dùng đọc được; `RankTable` đếm từ 0 nội bộ.
  return Number.isSafeInteger(page) && page >= 1 ? page - 1 : 0;
};

/**
 * Cùng bộ cột với P-21, TRỪ cột Ngân hàng và thay bằng cột Phòng.
 *
 * Bỏ cột Ngân hàng vì cả bảng chỉ có một ngân hàng. Thêm cột Phòng vì bảng này
 * gộp tài khoản của mọi phòng — người quản ngân hàng cần biết dòng nào của phòng
 * nào để hỏi lại đúng người.
 *
 * Không có link sang chi tiết tài khoản hay chi tiết khách: hai màn đó gác theo
 * phạm vi của `banking` và `customer`, mà người quản ngân hàng thường chỉ có
 * phạm vi phòng mình — link dẫn thẳng tới 404.
 */
const COLUMNS: RankColumn<BankAccountRow>[] = [
  { key: "date", label: "Ngày", sortable: true, render: (r) => (r.date ? formatDate(r.date) : "—") },
  { key: "customerName", label: "Khách hàng", render: (r) => r.customerName },
  {
    key: "accountNumber",
    label: "STK",
    render: (r) => <span className="tabular-nums">{formatPhone(r.accountNumber)}</span>,
  },
  { key: "referralCode", label: "Mã giới thiệu", render: (r) => r.referralCode },
  {
    key: "accountType",
    label: "Loại TK",
    render: (r) => (r.accountType === "none" ? "—" : ACCOUNT_TYPE_LABEL[r.accountType]),
  },
  {
    key: "status",
    label: "Trạng thái",
    render: (r) => (
      <StatusTag tone={r.status === "done" ? "ok" : r.status === "error" ? "warn" : "waiting"}>
        {BANK_ACCOUNT_STATUS_LABEL[r.status]}
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
    label: "Mã NV",
    // Mã nhân viên chứ không phải tên: app khác của công ty định danh theo mã.
    // Chưa gán mã thì hiện tên — ô trống không nói được ai đã tạo dòng đó.
    render: (r) => r.createdByStaffCode || r.createdByName || "—",
  },
  { key: "department", label: "Phòng", render: (r) => r.createdByDepartmentName ?? "—" },
];

type Tab = "accounts" | "photos";

const TAB_OPTIONS = [
  { value: "accounts", label: "Tài khoản" },
  { value: "photos", label: "Ảnh chứng minh" },
];

/**
 * Chi tiết một ngân hàng — mở rộng P-60: bấm mã ngân hàng ở bảng đi tới đây.
 * Hai tab dùng chung bộ lọc: bảng tài khoản và lưới ảnh chứng minh để tải hàng
 * loạt (chốt 2026-09-02, thay cho trang thư viện ảnh riêng).
 *
 * Bảng tài khoản ở đây KHÔNG kẹp phạm vi phòng: ai được giao quản ngân hàng thì
 * đọc được mọi tài khoản của ngân hàng đó (chốt 2026-09-01). Chốt thật nằm ở
 * route `GET /api/settings/banks/[id]/accounts`.
 */
export default function BankDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useSession((s) => s.user);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    searchParams.get("tab") === "photos" ? "photos" : "accounts",
  );
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = dateFromUrl(searchParams.get("from"));
    const to = dateFromUrl(searchParams.get("to"));
    return from || to ? { from, to } : undefined;
  });
  const [status, setStatus] = useState<BankAccountStatus | "">(() => {
    const parsed = BankAccountStatus.safeParse(searchParams.get("status"));
    return parsed.success ? parsed.data : "";
  });
  /** Bảng mã ở tab Kho mã giới thiệu dẫn tới đây kèm sẵn `referralCodeId`. */
  const [referralCodeId, setReferralCodeId] = useState(
    () => searchParams.get("referralCodeId") ?? "",
  );
  const [departmentId, setDepartmentId] = useState(
    () => searchParams.get("departmentId") ?? "",
  );
  /**
   * Hai tab hai trang RIÊNG, `page` trên URL thuộc về tab đang mở. Nạp lẫn
   * trang của tab kia là mở link ra một trang không khớp số trên URL.
   */
  const [page, setPage] = useState(() =>
    searchParams.get("tab") === "photos" ? 0 : pageFromUrl(searchParams.get("page")),
  );
  const [photoPage, setPhotoPage] = useState(() =>
    searchParams.get("tab") === "photos" ? pageFromUrl(searchParams.get("page")) : 0,
  );
  // Chỉ sắp theo ngày mở, và chỉ đổi được chiều — cùng lý do với P-21: khoá sắp
  // phải nằm trong chính bảng `bank_accounts`.
  const [dir, setDir] = useState<SortDir>(() =>
    searchParams.get("dir") === "asc" ? "asc" : "desc",
  );
  const [exporting, setExporting] = useState(false);

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const bank = banks.find((b) => b.id === id);

  /** Ngân hàng ngoài phạm vi thì không gọi mạng — máy chủ trả 403. */
  const inScope = canManageBank(user, id);

  /**
   * Ô lọc mã đọc TRỌN kho mã của ngân hàng, không gom từ các dòng đang hiện.
   *
   * Gom từ dòng thì ô chọn chỉ có mã tình cờ nằm ở trang đang xem — lọc theo mã
   * thứ 16 trở đi là không chọn được. Kho mã đổi chậm nên giữ lâu trong cache.
   */
  const { data: codes = [] } = useQuery({
    queryKey: ["bank-referral-code-options", id],
    queryFn: () => fetchBankReferralCodeOptions(id),
    enabled: inScope,
    staleTime: Infinity,
  });

  /** Danh sách phòng đổi vài tháng một lần — không có lý do hỏi lại mỗi lần mở màn. */
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    staleTime: Infinity,
  });

  const from = range?.from ? iso(range.from) : "";
  const to = range?.to ? iso(range.to) : "";

  /**
   * Mọi thứ làm đổi kết quả đều nằm trên URL — tải lại trang hay gửi link cho
   * người khác thì bảng hiện đúng cái đang xem, cùng cách màn P-13 làm.
   *
   * `replaceState` chứ không phải `push`: đổi bộ lọc không phải một bước điều
   * hướng, nhồi nó vào lịch sử thì nút Quay lại phải bấm nhiều lần mới ra khỏi
   * màn.
   */
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (tab === "photos") params.set("tab", tab);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (status) params.set("status", status);
    if (referralCodeId) params.set("referralCodeId", referralCodeId);
    if (departmentId) params.set("departmentId", departmentId);
    // `page` là trang của TAB ĐANG MỞ; `dir` chỉ có nghĩa với bảng tài khoản.
    const shownPage = tab === "photos" ? photoPage : page;
    if (shownPage > 0) params.set("page", String(shownPage + 1));
    if (tab === "accounts" && dir === "asc") params.set("dir", dir);
    const query = params.toString();
    return query ? `/settings/banks/${id}?${query}` : `/settings/banks/${id}`;
  }, [departmentId, dir, from, id, page, photoPage, referralCodeId, status, tab, to]);

  useEffect(() => {
    window.history.replaceState(null, "", listUrl);
  }, [listUrl]);

  const { data = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: [
      "bank-accounts-of-bank",
      id,
      from,
      to,
      status,
      referralCodeId,
      departmentId,
      page,
      dir,
    ],
    queryFn: () =>
      fetchBankAccountsOfBank(id, {
        from,
        to,
        status,
        referralCodeId,
        departmentId,
        page,
        sort: "date",
        dir,
      }),
    enabled: inScope,
    placeholderData: keepPreviousData,
  });

  /** Đổi bộ lọc thì cả hai tab về trang đầu — giữ trang 5 của kết quả cũ là hiện khúc rỗng. */
  const refine = (apply: () => void) => {
    apply();
    setPage(0);
    setPhotoPage(0);
  };

  /**
   * Xuất Excel đi qua đường RIÊNG, không dựng file từ trang đang xem.
   *
   * Dựng từ `data.rows` thì file chỉ có 15 dòng của trang hiện tại mà trông y
   * hệt file đầy đủ — người nhận không có cách nào biết.
   */
  const exportAll = async () => {
    setExporting(true);
    try {
      const { rows, total } = await fetchBankAccountsOfBankForExport(id, {
        from,
        to,
        status,
        referralCodeId,
        departmentId,
      });
      // Chỉ xảy ra khi số dòng vượt sức chứa của một sheet Excel. Không có
      // trần do hệ thống đặt ra ở đây.
      if (rows.length < total) {
        throw new Error(
          `Bộ lọc này có ${total.toLocaleString("vi-VN")} tài khoản, vượt sức chứa ${rows.length.toLocaleString("vi-VN")} dòng của một sheet Excel. Thu hẹp khoảng ngày rồi xuất làm nhiều đợt.`,
        );
      }
      await exportExcel({
        fileName: `tai-khoan-${bank?.code ?? "ngan-hang"}-${iso(new Date())}.xlsx`,
        sheetName: `Tài khoản ${bank?.code ?? ""}`.trim(),
        rows,
        columns: [
          { header: "Ngày", value: (r) => (r.date ? formatDate(r.date) : "") },
          { header: "Khách hàng", transform: "name", value: (r) => r.customerName },
          // `text` cho STK và mã: để mặc định thì Excel hiểu là số học và cắt
          // mất số 0 đầu.
          { header: "STK", type: "text", value: (r) => r.accountNumber },
          // Mã text ĐỨNG TRƯỚC tên hiển thị: file này đem đối chiếu với bảng
          // của ngân hàng, mà bên đó chỉ có chuỗi mã. Mã QR-only không có chuỗi
          // nào nên ô chỉ còn tên.
          {
            header: "Mã giới thiệu",
            type: "text",
            value: (r) =>
              [r.referralCodeText, r.referralCode].filter(Boolean).join(" - "),
          },
          {
            header: "Loại TK",
            value: (r) => (r.accountType === "none" ? "" : ACCOUNT_TYPE_LABEL[r.accountType]),
          },
          { header: "Trạng thái", value: (r) => BANK_ACCOUNT_STATUS_LABEL[r.status] },
          { header: "Đã cài app", value: (r) => (r.appInstalled ? "Có" : "Không") },
          // MÃ nhân viên chứ không phải tên: file này đem đối chiếu với app khác
          // của công ty, mà app đó định danh theo mã.
          { header: "Mã NV", type: "text", value: (r) => r.createdByStaffCode },
          { header: "Phòng", value: (r) => r.createdByDepartmentName ?? "" },
        ],
      });
      toast.ok(`Đã xuất ${rows.length.toLocaleString("vi-VN")} tài khoản`);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file Excel."));
    } finally {
      setExporting(false);
    }
  };

  const activeCount =
    (from && to ? 1 : 0) +
    (status ? 1 : 0) +
    (referralCodeId ? 1 : 0) +
    (departmentId ? 1 : 0);
  const codeName = codes.find((c) => c.id === referralCodeId)?.name ?? "";

  return (
    <RequirePermission allow={canOpenBankAdmin}>
      <TopBar title={bank?.code ?? "Ngân hàng"} keepTitleOnMobile>
        <FilterButton
          activeCount={activeCount}
          onClear={() =>
            refine(() => {
              setRange(undefined);
              setStatus("");
              setReferralCodeId("");
              setDepartmentId("");
            })
          }
        >
          <DateRangePicker
            label="Khoảng ngày"
            value={range}
            onChange={(v) => refine(() => setRange(v))}
          />
          <Select
            block
            label="Trạng thái"
            value={status}
            onChange={(v) => refine(() => setStatus(v as BankAccountStatus | ""))}
            options={[
              { value: "", label: "Tất cả trạng thái" },
              ...BankAccountStatus.options.map((s) => ({
                value: s,
                label: BANK_ACCOUNT_STATUS_LABEL[s],
              })),
            ]}
          />
          <Combobox
            block
            // Combobox chứ không phải Select: một ngân hàng có tới vài trăm mã,
            // mà `<select>` gốc không gõ tìm được — cùng lý do với ô lọc mã ở P-21.
            label="Mã giới thiệu"
            placeholder="Gõ để tìm mã…"
            value={referralCodeId}
            onChange={(v) => refine(() => setReferralCodeId(v))}
            options={[
              { value: "", label: "Tất cả mã giới thiệu" },
              ...codes.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            block
            label="Phòng"
            value={departmentId}
            onChange={(v) => refine(() => setDepartmentId(v))}
            options={[
              { value: "", label: "Tất cả phòng" },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
          <Button
            variant="secondary"
            block
            onClick={exportAll}
            disabled={exporting || data.total === 0}
          >
            <Download size={16} aria-hidden />
            Xuất Excel
          </Button>
        </FilterButton>
      </TopBar>

      <main className={styles.body}>
        <Link href="/settings/banks" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Ngân hàng &amp; mã giới thiệu
        </Link>

        <FilterChips
          chips={[
            ...(from && to
              ? [
                  {
                    label: `Ngày: ${formatDate(from)} → ${formatDate(to)}`,
                    onRemove: () => refine(() => setRange(undefined)),
                  },
                ]
              : []),
            ...(status
              ? [
                  {
                    label: `Trạng thái: ${BANK_ACCOUNT_STATUS_LABEL[status]}`,
                    onRemove: () => refine(() => setStatus("")),
                  },
                ]
              : []),
            ...(departmentId
              ? [
                  {
                    label: `Phòng: ${departments.find((d) => d.id === departmentId)?.name ?? ""}`,
                    onRemove: () => refine(() => setDepartmentId("")),
                  },
                ]
              : []),
            ...(referralCodeId
              ? [
                  {
                    // Vào màn bằng link có sẵn `referralCodeId` thì kho mã chưa
                    // nạp xong; chip để trống tên trông như đang hỏng.
                    label: codeName ? `Mã giới thiệu: ${codeName}` : "Mã giới thiệu",
                    onRemove: () => refine(() => setReferralCodeId("")),
                  },
                ]
              : []),
          ]}
        />

        <SectionTabs label="Khu vực" options={TAB_OPTIONS} value={tab} onChange={(v) => setTab(v as Tab)} />

        {tab === "photos" ? (
          <BankPhotoGallery
            /*
              `key` theo bộ lọc: đổi bộ lọc là dựng lại component, mất lượt chọn
              và về trang đầu (AGENTS.md §7 — reset state bằng key, không effect).
              Giữ lượt chọn qua bộ lọc là tải nhầm cả ảnh đã bị bộ lọc ẩn đi.
            */
            key={`${from}|${to}|${status}|${referralCodeId}|${departmentId}`}
            bankId={id}
            bankCode={bank?.code ?? ""}
            filters={{ from, to, status, referralCodeId, departmentId }}
            page={photoPage}
            onPageChange={setPhotoPage}
            inScope={inScope}
            hasActiveFilters={activeCount > 0}
          />
        ) : (
        <SectionCard
          title="Xem toàn bộ tài khoản theo ngân hàng"
          icon={<Landmark size={17} />}
          meta={inScope && !isPending ? `${data.total} dòng` : undefined}
        >
          {isError ? (
            <ErrorState
              what="tài khoản của ngân hàng này"
              onRetry={refetch}
              retrying={isFetching}
            />
          ) : isPending && inScope ? (
            <SkeletonTable rows={8} columns={COLUMNS.length} />
          ) : (
            <RankTable
              rows={data.rows}
              columns={COLUMNS}
              rowKey={(r) => r.id}
              defaultSort="date"
              // Bấm dòng mở trang chi tiết tài khoản trong khu quản ngân hàng
              // (chốt 2026-09-02) — cùng chốt canManageBank, không phải P-22.
              onRowClick={(r) => router.push(`/settings/banks/${id}/${r.id}`)}
              caption="Tài khoản đã mở ở ngân hàng này, mọi phòng"
              emptyText={
                !inScope
                  ? "Bạn không quản ngân hàng này."
                  : activeCount > 0
                    ? "Không có tài khoản nào khớp bộ lọc."
                    : "Ngân hàng này chưa có tài khoản nào."
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
          )}
        </SectionCard>
        )}
      </main>
    </RequirePermission>
  );
}
