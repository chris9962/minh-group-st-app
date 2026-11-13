"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { use, useState } from "react";
import { BackLink } from "@/components/ui/BackLink";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { TopBar } from "@/components/layout/TopBar";
import { BranchPanel } from "@/components/people/BranchPanel";
import { KpiAdjustmentSection } from "@/components/people/KpiAdjustmentSection";
import { PersonActivityTabs } from "@/components/people/PersonActivityTabs";
import { PersonAuditLog } from "@/components/people/PersonAuditLog";
import { PersonKpiPanel } from "@/components/people/PersonKpiPanel";
import { AccountCard } from "@/components/staff/AccountCard";
import { PaymentInfoCard } from "@/components/staff/PaymentInfoCard";
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
type SectionKey = "kpi" | "account" | "payment" | "audit";

const KPI_SECTION: SectionOption = { value: "kpi", label: "KPI & hoạt động" };
const ACCOUNT_SECTION: SectionOption = { value: "account", label: "Tài khoản & quyền" };
const PAYMENT_SECTION: SectionOption = { value: "payment", label: "Thông tin thanh toán" };
const AUDIT_SECTION: SectionOption = { value: "audit", label: "Nhật ký hoạt động" };

/** P-52 · Xem theo một nhân viên. */
export default function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  // Bảng Nhân sự đang xem tháng cũ thì gửi kèm `?month=`, hồ sơ mở sẵn tháng đó.
  const [period, setPeriod] = useState<PeriodMode>(() => {
    const month = searchParams.get("month");
    return month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month !== thisMonth()
      ? { kind: "month", month }
      : { kind: "this-month" };
  });
  /** Tab ngoài: hồ sơ KPI hay thẻ tài khoản đăng nhập. */
  const [section, setSection] = useState<SectionKey>("kpi");

  const current = thisMonth();
  /* Khối KPI và Lương theo THÁNG ĐANG CHỌN (chốt 2026-09-30, thay chốt
     2026-08-27 "luôn tháng hiện tại"): xem tháng cũ thì điểm, chỉ tiêu, lương,
     phòng và chức vụ là của tháng đó. "Hôm nay" vẫn là tháng hiện tại. */
  const listMonth = periodMonth(period, current);
  const summaryMonth = listMonth;
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
  const canManage =
    (can(actor, "staff", "create") || can(actor, "staff", "update")) && actor?.id !== id;
  const showAccount = canManage && section === "account";
  // Số tài khoản nhận lương: chỉ người có quyền chốt lương, cùng quyền với file chuyển lương.
  const canPayment = can(actor, "system", "close-salary");
  const showPayment = canPayment && section === "payment";
  // Cùng quyền với màn P-93: nhật ký có lượt xem CCCD, không mở theo `staff:*`.
  const canAudit = can(actor, "system", "manage-org");
  const showAudit = canAudit && section === "audit";
  const showKpi = !showAccount && !showPayment && !showAudit;
  const sections = [
    KPI_SECTION,
    ...(canManage ? [ACCOUNT_SECTION] : []),
    ...(canPayment ? [PAYMENT_SECTION] : []),
    ...(canAudit ? [AUDIT_SECTION] : []),
  ];

  const periodText = period.kind === "today" ? "Hôm nay" : monthLabel(listMonth);

  return (
    <>
      <TopBar title={data?.fullName ?? "Nhân viên"}>
        {/* Đổi kỳ là bốn danh sách đổi nội dung; `key` trên `PersonActivityTabs`
            lo phần reset trang. */}
        <PeoplePeriodPicker value={period} onChange={setPeriod} />
      </TopBar>

      <main className={styles.body}>
        {actor?.id !== id && <BackLink href="/users">Nhân sự &amp; KPI</BackLink>}

        {isPending && <SkeletonCard lines={5} />}
        {isError && (
          <ErrorState what="hồ sơ nhân viên này" onRetry={refetch} retrying={isFetching} />
        )}

        {data && sections.length > 1 && (
          <SectionTabs
            label="Khu vực hồ sơ"
            options={sections}
            value={section}
            onChange={(v) => setSection(v as SectionKey)}
          />
        )}

        {data && showAccount && (
          <div className={styles.accountSection}>
            <AccountCard staffId={id} />
          </div>
        )}

        {data && showPayment && (
          <div className={styles.accountSection}>
            <PaymentInfoCard staffId={id} />
          </div>
        )}

        {data && showAudit && <PersonAuditLog staffId={id} />}

        {/* Phó giám đốc: các phòng họ quản thay cho vòng điểm và bốn tab hoạt
            động, vì họ không lập hồ sơ nên hai khối đó luôn trống. */}
        {data && showKpi && data.branch && (
          <BranchPanel person={data} branch={data.branch} periodText={periodText} />
        )}

        {data && showKpi && !data.branch && (
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
