"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  CODE_STATUS_LABEL,
  fetchBanks,
  fetchReferralCodes,
  type CodeStatus,
  type ReferralCode,
  type ReferralCodeQuery,
} from "@/lib/api/bankCatalog";
import { EMPTY_PAGE, PAGE_SIZE } from "@/lib/api/pagination";
import { useDebouncedValue } from "@/lib/hooks";
import { ReferralCodeFormDialog } from "./ReferralCodeFormDialog";
import styles from "./ReferralCodesSection.module.scss";

const FIRST_PAGE: ReferralCodeQuery = {
  bankId: "",
  status: "",
  search: "",
  page: 0,
  sort: "progress",
  dir: "desc",
};

/**
 * P-61 · Kho mã giới thiệu — thêm mã lẻ ở đây; nhập hàng loạt từ Excel vẫn là P-62 (chưa làm).
 *
 * Lọc, tìm, sắp và cắt trang đều do máy chủ làm (AGENTS.md §5.1). Màn này chỉ
 * giữ CÂU HỎI trong `query` rồi hiện đúng những gì máy chủ trả về — không có
 * chỗ nào lọc lại trên dữ liệu đã tải.
 */
export function ReferralCodesSection() {
  const [query, setQuery] = useState<ReferralCodeQuery>(FIRST_PAGE);
  const [creating, setCreating] = useState(false);

  // Ô tìm giữ chữ đang gõ riêng, chỉ hoãn xong mới thành câu hỏi gửi đi. Nối
  // thẳng vào `query` thì mỗi phím là một lượt gọi máy chủ, mà mỗi lượt là một
  // phép gộp trên cả bảng tài khoản.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const { data: banks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });

  const asked: ReferralCodeQuery = { ...query, search: debouncedSearch };
  const { data: page = EMPTY_PAGE, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["referral-codes", asked],
    queryFn: () => fetchReferralCodes(asked),
    /**
     * Giữ trang cũ trong lúc tải trang mới. Không giữ thì `isPending` bật lại
     * theo từng lần đổi khoá: bảng bị thay bằng skeleton, số đếm nhảy về 0, và
     * nút "Sau" rời khỏi DOM — bấm hai lần liên tiếp là cú thứ hai rơi vào chỗ
     * trống, còn người dùng bàn phím thì mất tiêu điểm (AGENTS.md §8).
     */
    placeholderData: keepPreviousData,
  });

  /** Đổi bộ lọc thì về trang đầu — giữ nguyên trang 5 của kết quả cũ là hiện một khúc rỗng. */
  const refine = (patch: Partial<ReferralCodeQuery>) =>
    setQuery((q) => ({ ...q, ...patch, page: 0 }));

  // Kho rỗng và "lọc không ra gì" là hai chuyện khác nhau. Nói nhầm thì người
  // dùng đi xoá bộ lọc vốn đang trống, thay vì bấm "Thêm mã".
  const filtering = Boolean(debouncedSearch || query.bankId || query.status);

  const columns: RankColumn<ReferralCode>[] = [
    { key: "bank", label: "Ngân hàng", sortable: true, render: (c) => c.bankCode },
    { key: "code", label: "Mã", sortable: true, render: (c) => c.code },
    {
      key: "progress",
      label: "Đã dùng",
      sortable: true,
      ratio: (c) => (c.used / c.total) * 100,
      render: (c) => (
        <span className="tabular-nums">
          {c.used}/{c.total}
        </span>
      ),
    },
    {
      // Không cho sắp: khoá sắp xếp đi thẳng vào `ORDER BY` nên phải nằm trong
      // danh sách trắng `REFERRAL_CODE_SORT` ở máy chủ, mà cột này chưa có.
      key: "holding",
      label: "Đang giữ",
      render: (c) => <span className="tabular-nums">{c.holding}</span>,
    },
    {
      key: "status",
      label: "Trạng thái",
      render: (c) => (
        <StatusTag ok={c.status === "available"}>{CODE_STATUS_LABEL[c.status]}</StatusTag>
      ),
    },
  ];

  return (
    <SectionCard
      title="Kho mã giới thiệu"
      icon={<Ticket size={17} />}
      meta={isPending ? undefined : `${page.total} mã`}
      action={
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} />
          Thêm mã
        </Button>
      }
    >
      <div className={styles.filters}>
        <SearchField
          label="Tìm mã"
          placeholder="VPa, 884…"
          value={search}
          onChange={(v) => {
            // Về trang đầu ngay lúc gõ, không đợi hoãn xong: đang ở trang 3 mà
            // kết quả mới chỉ có 2 dòng thì trang 3 là một khúc rỗng.
            setSearch(v);
            setQuery((q) => ({ ...q, page: 0 }));
          }}
        />
        <Select
          label="Ngân hàng"
          value={query.bankId}
          onChange={(v) => refine({ bankId: v })}
          options={[
            { value: "", label: "Tất cả ngân hàng" },
            ...banks.map((b) => ({ value: b.id, label: b.code })),
          ]}
        />
        <Select
          label="Trạng thái"
          value={query.status}
          onChange={(v) => refine({ status: v as CodeStatus | "" })}
          options={[
            { value: "", label: "Tất cả trạng thái" },
            ...Object.entries(CODE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
      </div>

      {isPending && <SkeletonTable rows={5} columns={4} />}
      {isError && (
          <ErrorState what="kho mã giới thiệu" onRetry={refetch} retrying={isFetching} />
        )}

      {!isPending && !isError && (
        <>
          {page.total === 0 ? (
            <p className="text-muted">
              {filtering
                ? "Không có mã nào khớp bộ lọc."
                : "Kho mã đang rỗng — bấm “Thêm mã” ở đầu khối."}
            </p>
          ) : (
            <RankTable
              rows={page.rows}
              columns={columns}
              rowKey={(c) => c.id}
              defaultSort="progress"
              caption="Mã giới thiệu theo ngân hàng, tiến độ sử dụng và trạng thái"
              server={{
                sort: query.sort,
                dir: query.dir,
                page: query.page,
                total: page.total,
                pageSize: PAGE_SIZE,
                onSortChange: (sort, dir) =>
                  refine({ sort: sort as ReferralCodeQuery["sort"], dir }),
                onPageChange: (next) => setQuery((q) => ({ ...q, page: next })),
              }}
            />
          )}
        </>
      )}

      <p className={styles.footnote}>
        Thêm từng mã một ở đây. Nhập <strong>hàng loạt</strong> từ Excel vẫn là
        việc riêng của màn <strong>Nhập mã hàng loạt</strong> (P-62, chưa làm).
      </p>

      {creating && (
        <ReferralCodeFormDialog open onClose={() => setCreating(false)} />
      )}
    </SectionCard>
  );
}
