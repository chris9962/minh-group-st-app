"use client";

import { useQuery } from "@tanstack/react-query";
import { Hospital as HospitalIcon, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { fetchHospitals, type Hospital } from "@/lib/api/hospitalCatalog";
import { matchesSearch } from "@/lib/format";
import { HospitalFormDialog } from "./HospitalFormDialog";
import styles from "./HospitalCatalogSection.module.scss";

const COLUMNS: RankColumn<Hospital>[] = [{ key: "name", label: "Tên bệnh viện", render: (h) => h.name }];

/**
 * P-2.5 · Danh mục bệnh viện — danh sách phẳng dùng cho kênh Bệnh viện
 * (spec §2.5). Dùng chung cho mọi lần chọn kênh này, không phải cấu hình
 * riêng của từng kênh.
 */
export function HospitalCatalogSection() {
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const { data: hospitals = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["hospitals"],
    queryFn: fetchHospitals,
  });

  const visibleHospitals = useMemo(
    () => (search.trim() ? hospitals.filter((h) => matchesSearch(h.name, search)) : hospitals),
    [hospitals, search],
  );

  return (
    <>
      <SectionCard
        title="Danh mục bệnh viện"
        icon={<HospitalIcon size={17} />}
        meta={`${hospitals.length} bệnh viện`}
      >
        <SearchField
          label="Tìm bệnh viện"
          placeholder="Chợ Rẫy, Nhi đồng 1…"
          value={search}
          onChange={setSearch}
        />

        {isPending && <SkeletonTable rows={5} columns={3} />}
        {isError && (
          <ErrorState what="danh mục bệnh viện" onRetry={refetch} retrying={isFetching} />
        )}
        {!isPending && !isError && hospitals.length === 0 && (
          <p className="text-muted">Chưa có bệnh viện nào.</p>
        )}
        {!isPending && !isError && hospitals.length > 0 && visibleHospitals.length === 0 && (
          <p className="text-muted">Không tìm thấy bệnh viện nào khớp &quot;{search}&quot;.</p>
        )}

        {visibleHospitals.length > 0 && (
          <RankTable
            rows={visibleHospitals}
            columns={COLUMNS}
            rowKey={(h) => h.id}
            defaultSort="name"
            pageSize={15}
            caption="Danh mục bệnh viện dùng cho kênh Bệnh viện"
          />
        )}

        <div className={styles.footRow}>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm bệnh viện
          </Button>
        </div>

        <p className={styles.footnote}>
          Dùng cho kênh <strong>Bệnh viện</strong> ở P-20 — KD chọn thẳng từ danh sách này.
        </p>
      </SectionCard>

      {creating && <HospitalFormDialog open onClose={() => setCreating(false)} />}
    </>
  );
}
