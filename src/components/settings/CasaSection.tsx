"use client";

import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Gem } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { monthLabel } from "@/components/ui/MonthPicker";
import { SectionCard } from "@/components/ui/SectionCard";
import { SkeletonText } from "@/components/ui/Skeleton";
import { fetchCasaMonth } from "@/lib/api/casa";
import { CasaImportDialog } from "./CasaImportDialog";
import styles from "./CasaSection.module.scss";

/** Tài khoản CASA tính vào lương tháng `month`, kèm nút nhập file của ngân hàng. */
export function CasaSection({ month }: { month: string }) {
  const casa = useQuery({ queryKey: ["casa-month", month], queryFn: () => fetchCasaMonth(month) });
  const [importing, setImporting] = useState(false);

  return (
    <SectionCard
      title="Tài khoản CASA"
      icon={<Gem size={17} />}
      action={
        casa.data && !casa.data.locked ? (
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <FileSpreadsheet size={16} aria-hidden />
            Nhập file CASA
          </Button>
        ) : undefined
      }
    >
      {casa.isPending && <SkeletonText lines={1} label="Đang tải tài khoản CASA" />}
      {casa.isError && (
        <ErrorState what="tài khoản CASA" onRetry={casa.refetch} retrying={casa.isFetching} />
      )}
      {casa.data && (
        <p className={styles.count}>
          Lương {monthLabel(month).toLowerCase()}: {casa.data.count} tài khoản
        </p>
      )}
      {importing && <CasaImportDialog open month={month} onClose={() => setImporting(false)} />}
    </SectionCard>
  );
}
