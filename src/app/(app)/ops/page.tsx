"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, Images, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { CertificateWait } from "@/components/insurance/CertificateWait";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { CopyButton } from "@/components/ui/CopyValue";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Select } from "@/components/ui/Select";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { StatusTag } from "@/components/ui/StatusTag";
import { TextArea } from "@/components/ui/TextArea";
import {
  INSURANCE_STATUS_LABEL,
  INSURANCE_STATUS_TONE,
  InsuranceOrderStatus,
} from "@/lib/api/insuranceOrders";
import {
  fetchOpsOrders,
  fetchOpsSummary,
  OPS_DAY_RANGES,
  OPS_DEFAULT_DAYS,
  OPS_ORDER_DEFAULT_PRODUCT,
  OPS_ORDER_DEFAULT_STATUS,
  OPS_RECREATE_MAX,
  OPS_RECREATE_STATUS_LABEL,
  OPS_REFRESH_MAX,
  OPS_RESOURCE_PERCENT,
  recreateStuckOrders,
  refreshPolicies,
  type OpsBankCheck,
  type OpsOrderFilter,
  type OpsOrderRow,
  type OpsRecreateResult,
  type OpsRecreateStatus,
} from "@/lib/api/ops";
import { EMPTY_PAGE, PAGE_SIZE } from "@/lib/api/pagination";
import { formatBytes, formatCount, formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { InsuranceProduct, PRODUCT_LABEL } from "@/lib/types";
import { errorMessage, toast } from "@/lib/toast";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * P-99 · Vận hành hệ thống.
 *
 * Màn của người quản trị, gác bằng `system:view-ops`. Trả lời một câu hỏi duy
 * nhất: máy có đang chạy đúng không. Không có số kinh doanh nào ở đây — thứ đó
 * nằm ở Tổng quan P-80.
 *
 * Tự tải lại mỗi 60 giây: ba khối đều là trạng thái hiện tại, mở màn ra rồi để
 * đó mà số đứng yên thì người xem tưởng hàng đợi không nhúc nhích.
 */

const minutesLabel = (minutes: number): string =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút` : `${minutes} phút`;

/** Phần trăm đã dùng, cắt trong khoảng 0–100. Mẫu số 0 = chưa biết hạn mức. */
const percentOf = (used: number, total: number): number =>
  total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

/** Một ô tài nguyên: số phần trăm, thanh đo, và nhãn chữ khi vượt ngưỡng. */
function ResourceCard({
  label,
  used,
  total,
  percent,
  detail,
}: {
  label: string;
  used: string;
  total: string;
  percent: number;
  detail?: string;
}) {
  const high = percent >= OPS_RESOURCE_PERCENT;

  return (
    <div className={styles.resource}>
      <div className={styles.resourceHead}>
        <span className={styles.resourceLabel}>{label}</span>
        {/* Màu KHÔNG đứng một mình: vượt ngưỡng thì có nhãn chữ đi kèm. */}
        {high && <StatusTag tone="warn">Vượt {OPS_RESOURCE_PERCENT}%</StatusTag>}
      </div>
      <strong className={`${styles.resourceValue} tabular-nums`}>{percent}%</strong>
      <progress
        className={styles.meter}
        value={percent}
        max={100}
        aria-label={`${label}: đã dùng ${percent} phần trăm`}
      />
      <span className={styles.resourceDetail}>
        {used}
        {total ? ` / ${total}` : ""}
      </span>
      {detail && <span className={styles.resourceDetail}>{detail}</span>}
    </div>
  );
}

export default function OpsPage() {
  const user = useSession((s) => s.user);
  // `RequirePermission` che phần hiện ra, nhưng hook vẫn chạy — không chặn ở
  // đây thì người không có quyền vẫn bắn một lượt gọi để nhận đúng 403.
  const canView = can(user, "system", "view-ops");
  const canCreateOrder = can(user, "insurance", "create");
  const canRefresh = can(user, "insurance", "update");
  const queryClient = useQueryClient();

  const [days, setDays] = useState(OPS_DEFAULT_DAYS);
  const [filter, setFilter] = useState<OpsOrderFilter>({
    product: OPS_ORDER_DEFAULT_PRODUCT,
    status: OPS_ORDER_DEFAULT_STATUS,
  });
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [picked, setPicked] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<OpsRecreateStatus>("manual-queued");
  const [reason, setReason] = useState("Đơn kẹt chờ giấy chứng nhận");
  const [failures, setFailures] = useState<{ action: string; rows: OpsRecreateResult[] }>({
    action: "",
    rows: [],
  });

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["ops", days],
    queryFn: () => fetchOpsSummary(days),
    enabled: canView,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const orders = useQuery({
    queryKey: ["ops", "orders", page, dir, filter.product, filter.status],
    queryFn: () => fetchOpsOrders({ page, sort: "orderCode", dir }, filter),
    enabled: canView,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const rows = (orders.data ?? EMPTY_PAGE).rows;
  /**
   * Lọc lúc RENDER chứ không dọn bằng effect: danh sách tự tải lại mỗi phút và
   * đổi theo trang, nên `picked` còn giữ id không nằm trên trang đang xem. Con số
   * trên nút phải đếm đúng những dòng người dùng đang thấy.
   */
  const chosen = rows.filter((r) => picked.includes(r.id));
  const recreatable = chosen.filter((r) => r.canRecreate);
  const canPick = canCreateOrder || canRefresh;

  const refine = (next: Partial<OpsOrderFilter>) => {
    setFilter((prev) => ({ ...prev, ...next }));
    setPage(0);
    setPicked([]);
  };

  const finish = (
    action: string,
    okText: string,
    outcome: { done: number; failed: number; results: OpsRecreateResult[] },
  ) => {
    setPicked([]);
    setFailures({ action, rows: outcome.results.filter((r) => !r.ok) });
    if (outcome.done > 0) toast.ok(okText);
    if (outcome.failed > 0) toast.warn(`${outcome.failed} đơn không ${action.toLowerCase()} được`);
    queryClient.invalidateQueries({ queryKey: ["ops"] });
  };

  const recreate = useMutation({
    mutationFn: () =>
      recreateStuckOrders({ ids: recreatable.map((r) => r.id), status, reason: reason.trim() }),
    onSuccess: (outcome) => {
      setDialogOpen(false);
      finish("Cấp lại", `Đã cấp lại ${outcome.done} đơn`, outcome);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không cấp lại được lô đơn này.")),
  });

  const refresh = useMutation({
    mutationFn: () => refreshPolicies({ ids: chosen.map((r) => r.id) }),
    onSuccess: (outcome) =>
      finish("Chạy lại policy", `Đã đưa ${outcome.done} đơn vào hàng đợi GCN`, outcome),
    onError: (e) => toast.fail(errorMessage(e, "Không chạy lại được policy.")),
  });

  const bankColumns = useMemo<RankColumn<OpsBankCheck>[]>(
    () => [
      { key: "bank", label: "Ngân hàng", sortText: (r) => r.bankCode, render: (r) => r.bankCode },
      {
        key: "pending",
        label: "Đang đợi",
        sortBy: (r) => r.pending,
        render: (r) => formatCount(r.pending),
      },
      { key: "passed", label: "Đạt", sortBy: (r) => r.passed, render: (r) => formatCount(r.passed) },
      {
        key: "failed",
        label: "Không đạt",
        sortBy: (r) => r.failed,
        render: (r) => formatCount(r.failed),
      },
      {
        key: "error",
        label: "Lỗi kiểm",
        sortBy: (r) => r.error,
        render: (r) => formatCount(r.error),
      },
    ],
    [],
  );

  const orderColumns = useMemo<RankColumn<OpsOrderRow>[]>(
    () => [
      {
        key: "orderCode",
        label: "Mã đơn",
        sortable: true,
        render: (r) => (
          <Checkbox
            checked={picked.includes(r.id)}
            disabled={!canPick}
            onCheckedChange={(on) =>
              setPicked((prev) => (on ? [...prev, r.id] : prev.filter((id) => id !== r.id)))
            }
            label={r.orderCode}
          />
        ),
      },
      {
        key: "id",
        label: "ID",
        render: (r) => (
          <span className={styles.idCell}>
            {/* Rút gọn để đọc: uuid 36 ký tự không ai đọc tay, nút chép vẫn lấy đủ. */}
            {`${r.id.slice(0, 4)}…${r.id.slice(-4)}`}
            <CopyButton value={r.id} label={`ID đơn ${r.orderCode}: ${r.id}`} quiet />
          </span>
        ),
      },
      { key: "product", label: "Sản phẩm", render: (r) => PRODUCT_LABEL[r.product] },
      {
        key: "status",
        label: "Trạng thái",
        render: (r) => (
          <StatusTag tone={INSURANCE_STATUS_TONE[r.status]}>
            {r.status === "awaiting-certificate" && r.awaitingSince ? (
              <span>
                {INSURANCE_STATUS_LABEL[r.status]} <CertificateWait since={r.awaitingSince} />
              </span>
            ) : (
              INSURANCE_STATUS_LABEL[r.status]
            )}
          </StatusTag>
        ),
      },
    ],
    [picked, canPick],
  );

  const host = data?.host ?? null;

  return (
    <RequirePermission module="system" action="view-ops">
      <TopBar title="Vận hành hệ thống" keepTitleOnMobile />

      <main className={styles.body}>
        {isPending && <SkeletonTable rows={8} columns={5} />}
        {isError && <ErrorState what="số liệu vận hành" onRetry={refetch} retrying={isFetching} />}

        {!isPending && !isError && data && (
          <>
            <SectionCard
              title="Máy chủ"
              icon={<Cpu size={17} />}
              meta={host ? `Đo lúc ${formatDateTime(host.at)}` : "Chưa có số đo"}
            >
              {!host ? (
                // Rỗng chỉ có MỘT nguyên nhân: dịch vụ `mgst-ops-watch` chưa
                // chạy trên máy chủ. Tên dịch vụ không viết ra màn — người đọc
                // màn này đã có tài liệu deploy, mục 8e.
                <p className="text-muted">Chưa có số đo nào.</p>
              ) : (
                <div className={styles.resources}>
                  <ResourceCard
                    label="CPU"
                    percent={Math.round(host.cpuPercent)}
                    used={`${Math.round(host.cpuPercent)}% trong một phút`}
                    total=""
                  />
                  <ResourceCard
                    label="RAM"
                    percent={percentOf(host.ramUsed, host.ramTotal)}
                    used={formatBytes(host.ramUsed)}
                    total={formatBytes(host.ramTotal)}
                  />
                  <ResourceCard
                    label="Ổ đĩa"
                    percent={percentOf(host.diskUsed, host.diskTotal)}
                    used={formatBytes(host.diskUsed)}
                    total={formatBytes(host.diskTotal)}
                  />
                  <ResourceCard
                    label="S3"
                    percent={percentOf(host.s3Bytes, host.s3Quota)}
                    used={formatBytes(host.s3Bytes)}
                    total={host.s3Quota > 0 ? formatBytes(host.s3Quota) : ""}
                    detail={
                      host.s3At
                        ? `${formatCount(host.s3Objects)} tệp · đo lúc ${formatDateTime(host.s3At)}`
                        : "Chưa đo lần nào"
                    }
                  />
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Đơn chờ giấy chứng nhận"
              icon={<ShieldCheck size={17} />}
              meta={`${formatCount(data.insurance.awaiting)} đơn`}
            >
              <div className={styles.stats}>
                <StatCard
                  value={formatCount(data.insurance.awaiting)}
                  label="Đang chờ giấy chứng nhận"
                  tone={data.insurance.awaiting > 0 ? "attention" : "normal"}
                />
                <StatCard
                  value={
                    data.insurance.oldest
                      ? minutesLabel(data.insurance.oldest.waitingMinutes)
                      : "Không có"
                  }
                  label="Đơn chờ lâu nhất"
                  detail={
                    data.insurance.oldest
                      ? `${data.insurance.oldest.orderCode} - ${data.insurance.oldest.customerName}`
                      : undefined
                  }
                />
              </div>

              <div className={styles.filterRow}>
                <Select
                  label="Sản phẩm"
                  value={filter.product}
                  onChange={(v) => {
                    const parsed = InsuranceProduct.safeParse(v);
                    refine({ product: parsed.success ? parsed.data : "" });
                  }}
                  options={[
                    { value: "", label: "Tất cả" },
                    ...InsuranceProduct.options.map((p) => ({ value: p, label: PRODUCT_LABEL[p] })),
                  ]}
                />
                <Select
                  label="Trạng thái"
                  value={filter.status}
                  onChange={(v) => {
                    const parsed = InsuranceOrderStatus.safeParse(v);
                    refine({ status: parsed.success ? parsed.data : "" });
                  }}
                  options={[
                    { value: "", label: "Tất cả" },
                    ...InsuranceOrderStatus.options.map((s) => ({
                      value: s,
                      label: INSURANCE_STATUS_LABEL[s],
                    })),
                  ]}
                />
              </div>

              {failures.rows.length > 0 && (
                <Alert tone="warning">
                  <strong>
                    {failures.rows.length} đơn không {failures.action.toLowerCase()} được
                  </strong>
                  <ul className={styles.failList}>
                    {failures.rows.map((f) => (
                      <li key={f.id}>
                        {f.orderCode || f.id}: {f.message}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}

              {canPick && (
                <div className={styles.actions}>
                  {canRefresh && (
                    <Button
                      onClick={() => refresh.mutate()}
                      disabled={
                        refresh.isPending || chosen.length === 0 || chosen.length > OPS_REFRESH_MAX
                      }
                    >
                      {refresh.isPending
                        ? "Đang chạy lại policy…"
                        : `Chạy lại policy${chosen.length > 0 ? ` (${chosen.length})` : ""}`}
                    </Button>
                  )}
                  {canCreateOrder && (
                    <Button
                      variant="ghost"
                      onClick={() => setDialogOpen(true)}
                      disabled={recreatable.length === 0 || recreatable.length > OPS_RECREATE_MAX}
                    >
                      Huỷ và cấp lại {recreatable.length > 0 ? `(${recreatable.length})` : ""}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={rows.length === 0}
                    onClick={() =>
                      setPicked(chosen.length === rows.length ? [] : rows.map((r) => r.id))
                    }
                  >
                    {rows.length > 0 && chosen.length === rows.length ? "Bỏ chọn hết" : "Chọn hết"}
                  </Button>
                </div>
              )}

              {orders.isError ? (
                <ErrorState
                  what="danh sách đơn"
                  onRetry={orders.refetch}
                  retrying={orders.isFetching}
                />
              ) : orders.isPending ? (
                <SkeletonTable rows={8} columns={7} />
              ) : (
                <RankTable
                  rows={rows}
                  columns={orderColumns}
                  rowKey={(r) => r.id}
                  defaultSort="orderCode"
                  caption="Đơn bảo hiểm theo bộ lọc"
                  emptyText="Không đơn nào khớp bộ lọc."
                  server={{
                    sort: "orderCode",
                    dir,
                    page,
                    total: orders.data?.total ?? 0,
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

            <SectionCard
              title="Kiểm ảnh tài khoản"
              icon={<Images size={17} />}
              meta={`${formatCount(data.photoCheck.pending)} lượt đang đợi`}
            >
              <div className={styles.stats}>
                <StatCard
                  value={formatCount(data.photoCheck.pending)}
                  label="Đang đợi kiểm"
                  tone={data.photoCheck.pending > 0 ? "attention" : "normal"}
                />
                <StatCard
                  value={
                    data.photoCheck.oldestPendingAt
                      ? formatDateTime(data.photoCheck.oldestPendingAt)
                      : "Không có"
                  }
                  label="Lượt đợi lâu nhất"
                />
              </div>

              <div className={styles.rangeRow}>
                <SegmentedTabs
                  label="Khoảng thống kê"
                  value={String(days)}
                  onChange={(v) => setDays(Number(v))}
                  options={OPS_DAY_RANGES.map((d) => ({ value: String(d), label: `${d} ngày` }))}
                />
              </div>

              <RankTable
                rows={data.photoCheck.banks}
                columns={bankColumns}
                rowKey={(r) => r.bankId}
                defaultSort="pending"
                caption="Kết quả kiểm ảnh theo ngân hàng"
                emptyText="Chưa có lượt kiểm nào trong khoảng này."
              />
            </SectionCard>
          </>
        )}
      </main>

      <Dialog
        open={dialogOpen}
        title={`Huỷ và cấp lại ${recreatable.length} đơn`}
        onClose={() => setDialogOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Thôi
            </Button>
            <Button
              onClick={() => recreate.mutate()}
              disabled={recreate.isPending || reason.trim().length < 2 || recreatable.length === 0}
            >
              {recreate.isPending ? "Đang chạy…" : "Huỷ và cấp lại"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <Alert tone="warning">
            Mỗi đơn chọn ở đây sẽ huỷ rồi lập một đơn mới thay cho nó. Đơn cũ không lấy lại được.
          </Alert>

          <Select
            label="Trạng thái đơn mới"
            block
            value={status}
            onChange={(v) => setStatus(v as OpsRecreateStatus)}
            options={[
              { value: "manual-queued", label: OPS_RECREATE_STATUS_LABEL["manual-queued"] },
              { value: "queued", label: OPS_RECREATE_STATUS_LABEL.queued },
            ]}
          />

          <TextArea
            label="Lý do huỷ"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <ul className={styles.pickedList}>
            {recreatable.map((r) => (
              <li key={r.id}>
                {r.orderCode} - {r.customerName}
              </li>
            ))}
          </ul>

          {chosen.length > recreatable.length && (
            <>
              <p>{chosen.length - recreatable.length} đơn đã chọn không cấp lại được:</p>
              <ul className={styles.pickedList}>
                {chosen
                  .filter((r) => !r.canRecreate)
                  .map((r) => (
                    <li key={r.id}>
                      {r.orderCode}: {r.blockedReason}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </div>
      </Dialog>
    </RequirePermission>
  );
}
