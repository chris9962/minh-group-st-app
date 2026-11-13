"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Target } from "lucide-react";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonText } from "@/components/ui/Skeleton";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  KIND_LABEL,
  PLAN_LABEL,
  SocialInsuranceKind,
  SocialInsurancePlan,
} from "@/lib/api/socialInsurance";
import {
  fetchSocialInsuranceSettings,
  MAX_REVENUE_PER_POINT,
  saveSocialInsuranceSettings,
  type SocialInsuranceSettings,
} from "@/lib/api/socialInsuranceSettings";
import { invalidateKpi } from "@/lib/invalidateKpi";
import { parseMoneyCents } from "@/lib/money";
import { decimalOnly } from "@/lib/numberField";
import { errorMessage, toast } from "@/lib/toast";
import styles from "./SocialInsuranceSettingsSection.module.scss";

/** % hoa hồng và mức điểm KPI An Sinh của một tháng. */
export function SocialInsuranceSettingsSection({ month }: { month: string }) {
  const settings = useQuery({
    queryKey: ["social-insurance-settings", month],
    queryFn: () => fetchSocialInsuranceSettings(month),
    // Form dựng lại theo lần tải: tự tải lại khi quay về tab là mất số đang gõ.
    staleTime: Infinity,
  });
  return (
    <>
      {settings.isPending && <SkeletonText lines={4} label="Đang tải cấu hình" />}
      {settings.isError && (
        <ErrorState what="cấu hình BHYT/BHXH" onRetry={settings.refetch} retrying={settings.isFetching} />
      )}
      {settings.data && (
        // `key` theo tháng và lần tải: đổi tháng hay lưu xong thì form lấy lại số từ máy chủ (AGENTS.md §7).
        <SettingsForm key={`${month}-${settings.dataUpdatedAt}`} data={settings.data} />
      )}
    </>
  );
}

type RateText = { receive: string; pay: string };

/** `9120` ra `9,12`. */
const rateText = (rate: number) => String(rate / 1000).replace(".", ",");

/** `9,12` hoặc `9.12` ra `9120`; tối đa 3 số lẻ và 100%. Sai dạng ra `null`. */
function rateValue(text: string): number | null {
  const v = text.trim();
  if (!/^\d+([.,]\d{1,3})?$/.test(v)) return null;
  const rate = Math.round(Number(v.replace(",", ".")) * 1000);
  return rate <= 100_000 ? rate : null;
}

/** `9.000.000` hoặc `9.000.000,00` ra `9000000`; lẻ đồng, bằng 0 hay quá trần ra `null`. */
function revenueValue(text: string): number | null {
  const cents = parseMoneyCents(text);
  if (cents === null || cents === "invalid" || cents % 100 !== 0) return null;
  const value = cents / 100;
  return value > 0 && value <= MAX_REVENUE_PER_POINT ? value : null;
}

const percentError = (text: string) =>
  text.trim() === "" ? "Nhập %" : rateValue(text) === null ? "Không hợp lệ" : null;
const revenueError = (text: string) =>
  text.trim() === "" ? "Nhập số tiền" : revenueValue(text) === null ? "Không hợp lệ" : null;

const moneyText = (value: number) => new Intl.NumberFormat("vi-VN").format(value);

/** Mỗi loại mỗi phương án đúng một dòng, cho cả % hoa hồng và mức điểm. */
const PLAN_KEYS = SocialInsuranceKind.options.flatMap((kind) =>
  SocialInsurancePlan.options.map((plan) => ({ kind, plan })),
);

type RateValues = { kind: string; plan: string; receiveRate: number | null; payRate: number | null };
type KpiValues = { kind: string; plan: string; revenuePerPoint: number | null };

/** Bộ số theo thứ tự cố định, để so số đang gõ với số đã tải. */
const snapshot = (rates: RateValues[], kpi: KpiValues[]) =>
  JSON.stringify([
    rates.map((r) => [r.kind, r.plan, r.receiveRate, r.payRate].join("|")).sort(),
    kpi.map((k) => [k.kind, k.plan, k.revenuePerPoint].join("|")).sort(),
  ]);

function SettingsForm({ data }: { data: SocialInsuranceSettings }) {
  const queryClient = useQueryClient();
  const [rates, setRates] = useState<Record<string, RateText>>(() =>
    Object.fromEntries(
      PLAN_KEYS.map(({ kind, plan }) => {
        const row = data.rates.find((r) => r.kind === kind && r.plan === plan);
        return [
          `${kind}|${plan}`,
          { receive: row ? rateText(row.receiveRate) : "", pay: row ? rateText(row.payRate) : "" },
        ];
      }),
    ),
  );
  const [kpi, setKpi] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      PLAN_KEYS.map(({ kind, plan }) => {
        const row = data.kpi.find((k) => k.kind === kind && k.plan === plan);
        return [`${kind}|${plan}`, row ? moneyText(row.revenuePerPoint) : ""];
      }),
    ),
  );
  const [confirming, setConfirming] = useState(false);

  const parsedRates = PLAN_KEYS.map(({ kind, plan }) => {
    const text = rates[`${kind}|${plan}`];
    return { kind, plan, receiveRate: rateValue(text.receive), payRate: rateValue(text.pay) };
  });
  const parsedKpi = PLAN_KEYS.map(({ kind, plan }) => ({
    kind,
    plan,
    revenuePerPoint: revenueValue(kpi[`${kind}|${plan}`]),
  }));
  const valid =
    parsedRates.every((r) => r.receiveRate !== null && r.payRate !== null) &&
    parsedKpi.every((k) => k.revenuePerPoint !== null);
  // Tháng đang dùng bộ của tháng khác: lưu y nguyên cũng là tạo bộ riêng cho tháng này.
  const changed =
    data.ratesFrom !== null ||
    data.kpiFrom !== null ||
    snapshot(parsedRates, parsedKpi) !== snapshot(data.rates, data.kpi);

  const save = useMutation({
    mutationFn: () =>
      saveSocialInsuranceSettings(data.month, {
        rates: parsedRates.map((r) => ({ ...r, receiveRate: r.receiveRate!, payRate: r.payRate! })),
        kpi: parsedKpi.map((k) => ({ ...k, revenuePerPoint: k.revenuePerPoint! })),
      }),
    onSuccess: (next) => {
      setConfirming(false);
      // Các tháng sau chưa có bộ riêng đang mượn bộ vừa lưu: bỏ cache của chúng để đọc lại.
      queryClient.removeQueries({ queryKey: ["social-insurance-settings"] });
      queryClient.setQueryData(["social-insurance-settings", data.month], next);
      invalidateKpi(queryClient);
      toast.ok(`Đã lưu cấu hình ${monthLabel(data.month).toLowerCase()}`);
    },
    onError: (e) => toast.fail(errorMessage(e, "Không lưu được cấu hình.")),
  });

  const locked = data.locked;
  const setRate = (key: string, patch: Partial<RateText>) =>
    setRates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const copiedFrom = data.ratesFrom ?? data.kpiFrom;

  return (
    <>
      {copiedFrom && (
        <Alert tone="warning">
          {monthLabel(data.month)} chưa lưu cấu hình riêng, đang dùng cấu hình của{" "}
          {monthLabel(copiedFrom).toLowerCase()}.
        </Alert>
      )}

      <SectionCard
        title="% hoa hồng"
        icon={<Percent size={17} />}
        action={locked ? <StatusTag tone="neutral">Đã chốt lương</StatusTag> : undefined}
      >
        <div className={styles.scroll}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Loại</th>
                <th scope="col">Phương án</th>
                <th scope="col">% nhận</th>
                <th scope="col">% chi</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_KEYS.map(({ kind, plan }) => {
                const key = `${kind}|${plan}`;
                const name = `${KIND_LABEL[kind]} ${PLAN_LABEL[plan]}`;
                return (
                  <tr key={key}>
                    <td>{KIND_LABEL[kind]}</td>
                    <td>{PLAN_LABEL[plan]}</td>
                    <td>
                      <CellInput
                        className={styles.cellInput}
                        inputMode="decimal"
                        aria-label={`${name}: % nhận`}
                        error={percentError(rates[key].receive)}
                        value={rates[key].receive}
                        disabled={locked}
                        onChange={(e) => setRate(key, { receive: decimalOnly(e.target.value) })}
                      />
                    </td>
                    <td>
                      <CellInput
                        className={styles.cellInput}
                        inputMode="decimal"
                        aria-label={`${name}: % chi`}
                        error={percentError(rates[key].pay)}
                        value={rates[key].pay}
                        disabled={locked}
                        onChange={(e) => setRate(key, { pay: decimalOnly(e.target.value) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Mức điểm KPI An Sinh" icon={<Target size={17} />}>
        <div className={styles.scroll}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Loại</th>
                <th scope="col">Phương án</th>
                <th scope="col">Doanh thu cho 1 điểm</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_KEYS.map(({ kind, plan }) => {
                const key = `${kind}|${plan}`;
                return (
                  <tr key={key}>
                    <td>{KIND_LABEL[kind]}</td>
                    <td>{PLAN_LABEL[plan]}</td>
                    <td>
                      <CellInput
                        className={styles.moneyInput}
                        inputMode="numeric"
                        aria-label={`${KIND_LABEL[kind]} ${PLAN_LABEL[plan]}: Doanh thu cho 1 điểm`}
                        error={revenueError(kpi[key])}
                        value={kpi[key]}
                        disabled={locked}
                        onChange={(e) => setKpi((prev) => ({ ...prev, [key]: decimalOnly(e.target.value) }))}
                        onBlur={() => {
                          const value = revenueValue(kpi[key]);
                          if (value !== null) setKpi((prev) => ({ ...prev, [key]: moneyText(value) }));
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className={styles.saveBar}>
        <Button disabled={locked || !valid || !changed || save.isPending} onClick={() => setConfirming(true)}>
          Lưu cấu hình
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          open
          title={`Lưu cấu hình ${monthLabel(data.month).toLowerCase()}`}
          confirmLabel="Lưu"
          pending={save.isPending}
          onConfirm={() => save.mutate()}
          onClose={() => setConfirming(false)}
        >
          Bạn muốn lưu cấu hình BHYT/BHXH {monthLabel(data.month).toLowerCase()}?
        </ConfirmDialog>
      )}
    </>
  );
}

/** Ô nhập trong bảng. Câu lỗi nối vào ô để màu viền không là tín hiệu duy nhất. */
function CellInput({
  error,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { error: string | null; className: string }) {
  const errorId = useId();
  return (
    <>
      <input
        className={`input ${className}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && (
        <span id={errorId} className={styles.cellError}>
          {error}
        </span>
      )}
    </>
  );
}
