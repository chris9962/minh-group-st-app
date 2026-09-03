"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { KpiAdjustmentSection } from "@/components/people/KpiAdjustmentSection";
import { PersonActivityTabs } from "@/components/people/PersonActivityTabs";
import { PersonKpiPanel } from "@/components/people/PersonKpiPanel";
import { AccountCard } from "@/components/staff/AccountCard";
import { monthLabel, thisMonth } from "@/components/ui/MonthPicker";
import { PeoplePeriodPicker } from "@/components/ui/PeoplePeriodPicker";
import { SectionTabs, type SectionOption } from "@/components/ui/SectionTabs";
import { periodMonth, periodParam, type PeriodMode } from "@/lib/api/people";
import { fetchPerson } from "@/lib/api/person";
import { businessDay, monthRange } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

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
  const [period, setPeriod] = useState<PeriodMode>({ kind: "this-month" });
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

  /* Kỳ gửi xuống bốn tab là KHOẢNG NGÀY tường minh from/to, không phải token. */
  const range =
    period.kind === "today"
      ? { from: businessDay(), to: businessDay() }
      : monthRange(listMonth);

  // Thẻ tài khoản chỉ hiện với người quản trị được tài khoản — không có quyền
  // thì `AccountCard` trả về null, bày ra một tab rỗng cho họ bấm là vô nghĩa.
  const actor = useSession((st) => st.user);
  const canManage = can(actor, "staff", "create") || can(actor, "staff", "update");
  const showAccount = canManage && section === "account";

  const periodText = period.kind === "today" ? "Hôm nay" : monthLabel(listMonth);

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
        {/* Đổi kỳ là bốn danh sách đổi nội dung; `key` trên `PersonActivityTabs`
            lo phần reset trang. */}
        <PeoplePeriodPicker value={period} onChange={setPeriod} />
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
              <PersonActivityTabs
                // Đổi kỳ là reset trang và chiều sắp của cả bốn tab.
                key={`${range.from}:${range.to}`}
                staffId={id}
                from={range.from}
                to={range.to}
                periodText={periodText}
                insuranceCancelled={data.counts.insuranceCancelled}
                personName={data.fullName}
              />
            </div>
          </div>
        )}
      </main>
    </>
  );
}
