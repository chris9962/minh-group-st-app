"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Ticket } from "lucide-react";
import { useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  CODE_SCOPE_LABEL,
  CODE_STATUS_LABEL,
  fetchBanks,
  fetchReferralCodes,
  setReferralCodeActive,
  type CodeStatus,
  type ReferralCode,
  type ReferralCodeQuery,
} from "@/lib/api/bankCatalog";
import { fetchDepartments } from "@/lib/api/departments";
import { banksInScope } from "@/lib/permissions";
import { useSession } from "@/store/session";
import { EMPTY_PAGE, PAGE_SIZE } from "@/lib/api/pagination";
import { useDebouncedValue } from "@/lib/hooks";
import { ReferralCodeFormDialog } from "./ReferralCodeFormDialog";
import styles from "./ReferralCodesSection.module.scss";
import { errorMessage, toast } from "@/lib/toast";

const FIRST_PAGE: ReferralCodeQuery = {
  bankId: "",
  departmentId: "",
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
type Props = {
  /**
   * Nút "Thêm mã" nằm ở thanh tiêu đề TRANG, cùng cách `BankCatalogSection`
   * làm — trang giữ trạng thái mở hộp thoại, khối này chỉ nhận vào.
   */
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
};

export function ReferralCodesSection({ creating, onCreatingChange }: Props) {
  const actor = useSession((s) => s.user);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState<ReferralCodeQuery>(FIRST_PAGE);
  const [editing, setEditing] = useState<ReferralCode | null>(null);
  const [confirming, setConfirming] = useState<ReferralCode | null>(null);

  // Ô tìm giữ chữ đang gõ riêng, chỉ hoãn xong mới thành câu hỏi gửi đi. Nối
  // thẳng vào `query` thì mỗi phím là một lượt gọi máy chủ, mà mỗi lượt là một
  // phép gộp trên cả bảng tài khoản.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const { data: allBanks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  // Ô lọc chỉ hiện ngân hàng người này quản — máy chủ cũng chỉ trả mã của
  // những ngân hàng đó, nên lọc theo ngân hàng khác luôn ra bảng trống.
  const banks = banksInScope(actor, allBanks);
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
  });
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));

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
  const filtering = Boolean(debouncedSearch || query.bankId || query.departmentId || query.status);

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setReferralCodeActive(id, next),
    onSuccess: (_item, { next }) => {
      // Tiền tố phủ luôn khoá ["referral-codes", "open", …] — ô chọn mã ở P-20
      // bỏ mã vừa ngừng ra ngay, không đợi cache hết hạn.
      queryClient.invalidateQueries({ queryKey: ["referral-codes"] });
      toast.ok(next ? "Đã cho dùng lại mã" : "Đã ngừng mã");
      setConfirming(null);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không đổi được trạng thái mã này.")),
  });

  const columns: RankColumn<ReferralCode>[] = [
    { key: "bank", label: "Ngân hàng", sortable: true, render: (c) => c.bankCode },
    { key: "code", label: "Mã", sortable: true, render: (c) => c.code },
    {
      // Không cho sắp: khoá sắp phải nằm trong danh sách trắng của máy chủ.
      key: "province",
      label: "Tỉnh · Chi nhánh",
      render: (c) =>
        [c.province, c.supportBranch].filter(Boolean).join(" · ") || (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "priority",
      label: "Ưu tiên",
      sortable: true,
      render: (c) => <span className="tabular-nums">{c.priority}</span>,
    },
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
      /* Không cho sắp: khoá sắp đi thẳng vào `ORDER BY` nên phải nằm trong danh
         sách trắng của máy chủ, mà cột này chưa có. */
      key: "scope",
      label: "Phạm vi",
      render: (c) =>
        c.scope === "all" ? (
          CODE_SCOPE_LABEL.all
        ) : (
          <span className={styles.scopeNames}>
            {c.departmentIds.map((id) => departmentName.get(id) ?? id).join(", ")}
          </span>
        ),
    },
    {
      key: "status",
      label: "Trạng thái",
      // "Đã ngừng" đè lên nhãn tiến độ: mã tắt thì còn chỗ hay không cũng không
      // ai chọn được, hiện "Còn chỗ" là nói dối.
      render: (c) =>
        c.active ? (
          <StatusTag ok={c.status === "available"}>{CODE_STATUS_LABEL[c.status]}</StatusTag>
        ) : (
          <StatusTag ok={false}>Đã ngừng</StatusTag>
        ),
    },
    {
      /* Chỉ báo CÓ hay KHÔNG, không in cả link. Link mở tài khoản dài vài trăm
         ký tự — in ra thì bảng tràn ngang mà không ai đọc chuỗi đó bằng mắt.
         Người cần xem đầy đủ thì mở hộp thoại sửa mã. */
      key: "openUrl",
      label: "Link mở TK",
      render: (c) =>
        c.openUrl ? (
          <a
            href={c.openUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.openLink}
            title={c.openUrl}
          >
            <ExternalLink size={14} aria-hidden />
            Mở
          </a>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "actions",
      label: "Thao tác",
      render: (c) => (
        <span className={styles.actions}>
          <Button
            variant="secondary"
            icon
            tooltip="Sửa mã"
            aria-label={`Sửa mã ${c.code}`}
            onClick={() => setEditing(c)}
          >
            <Pencil size={16} aria-hidden />
          </Button>
          <Button
            variant="secondary"
            disabled={toggleActive.isPending}
            onClick={() => setConfirming(c)}
          >
            {c.active ? "Ngừng" : "Dùng lại"}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <SectionCard
      title="Kho mã giới thiệu"
      icon={<Ticket size={17} />}
      meta={isPending ? undefined : `${page.total} mã`}
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
          label="Phòng áp dụng"
          value={query.departmentId}
          onChange={(v) => refine({ departmentId: v })}
          options={[
            { value: "", label: "Tất cả phòng" },
            ...departments.map((department) => ({ value: department.id, label: department.name })),
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

      {(creating || editing) && (
        <ReferralCodeFormDialog
          open
          referral={editing}
          onClose={() => {
            onCreatingChange(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.active ? "Ngừng mã giới thiệu" : "Dùng lại mã giới thiệu"}
        confirmLabel={confirming?.active ? "Ngừng" : "Dùng lại"}
        pending={toggleActive.isPending}
        onConfirm={() =>
          confirming && toggleActive.mutate({ id: confirming.id, next: !confirming.active })
        }
        onClose={() => setConfirming(null)}
        consequence={
          confirming?.active ? (
            <>
              Mã rời ô chọn ở màn mở tài khoản ngay, kể cả khi còn chỗ. Tài
              khoản đã mở bằng mã này không bị đụng.
            </>
          ) : (
            <>Mã hiện lại trong ô chọn nếu còn chỗ trống.</>
          )
        }
      >
        {confirming?.active ? "Ngừng" : "Dùng lại"} mã <strong>{confirming?.code}</strong> của
        ngân hàng <strong>{confirming?.bankCode}</strong>?
      </ConfirmDialog>
    </SectionCard>
  );
}
