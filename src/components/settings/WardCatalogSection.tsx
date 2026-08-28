"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { fetchProvinces, type Province, type Ward } from "@/lib/api/wardCatalog";
import { matchesSearch } from "@/lib/format";
import { HamletFormDialog } from "./HamletFormDialog";
import { ProvinceFormDialog } from "./ProvinceFormDialog";
import { WardFormDialog } from "./WardFormDialog";
import styles from "./WardCatalogSection.module.scss";

const matchesProvince = (p: Province, query: string): boolean =>
  matchesSearch(p.name, query) ||
  p.wards.some((w) => matchesSearch(w.name, query) || w.hamlets.some((h) => matchesSearch(h.name, query)));

/**
 * P-71 · Danh mục xã / ấp — cây BA cấp Tỉnh/thành phố → Xã/phường → Ấp/khu
 * vực (spec §2.4). Danh mục bắt đầu rỗng — quản lý tự "triển khai" từng
 * tỉnh/xã một, chỉ những tỉnh/xã đã thêm ở đây mới hiện ra khi mở tài khoản
 * ngân hàng.
 */
export function WardCatalogSection() {
  const [addingProvince, setAddingProvince] = useState(false);
  const [addingWardTo, setAddingWardTo] = useState<Province | null>(null);
  const [addingHamletTo, setAddingHamletTo] = useState<Ward | null>(null);
  const [search, setSearch] = useState("");

  const { data: provinces = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["provinces"],
    queryFn: fetchProvinces,
  });

  const visibleProvinces = useMemo(
    () => (search.trim() ? provinces.filter((p) => matchesProvince(p, search)) : provinces),
    [provinces, search],
  );

  return (
    <>
      <SectionCard
        title="Danh mục tỉnh / xã / ấp"
        icon={<MapPin size={17} />}
        meta={isPending ? undefined : `${provinces.length} tỉnh/thành phố`}
      >
        <SearchField
          label="Tìm tỉnh, xã hoặc ấp"
          placeholder="Cần Thơ, Ninh Kiều, Ấp 2…"
          value={search}
          onChange={setSearch}
        />

        {isPending && <SkeletonTable rows={5} columns={4} />}
        {isError && (
          <ErrorState what="danh mục tỉnh/xã/ấp" onRetry={refetch} retrying={isFetching} />
        )}
        {!isPending && !isError && provinces.length === 0 && (
          <p className="text-muted">
            Chưa triển khai tỉnh/thành phố nào — bấm &quot;Thêm tỉnh/thành phố&quot; bên dưới.
          </p>
        )}
        {!isPending && !isError && provinces.length > 0 && visibleProvinces.length === 0 && (
          <p className="text-muted">Không tìm thấy gì khớp &quot;{search}&quot;.</p>
        )}

        <div className={styles.provinces}>
          {visibleProvinces.map((province) => (
            <div key={province.id} className={styles.provinceCard}>
              <div className={styles.provinceHead}>
                <span className={styles.provinceName}>{province.name}</span>
                <Button variant="secondary" onClick={() => setAddingWardTo(province)}>
                  <Plus size={14} />
                  Thêm xã/phường
                </Button>
              </div>

              {province.wards.length === 0 ? (
                <p className="text-muted">Chưa có xã/phường nào.</p>
              ) : (
                <div className={styles.wards}>
                  {province.wards.map((ward) => (
                    <div key={ward.id} className={styles.wardCard}>
                      <div className={styles.wardHead}>
                        <span className={styles.wardName}>{ward.name}</span>
                        <Button variant="secondary" onClick={() => setAddingHamletTo(ward)}>
                          <Plus size={14} />
                          Thêm ấp
                        </Button>
                      </div>

                      {ward.hamlets.length === 0 ? (
                        <p className="text-muted">Chưa có ấp nào.</p>
                      ) : (
                        <ul className={styles.hamlets}>
                          {ward.hamlets.map((h) => (
                            <li key={h.id} className={styles.hamlet}>
                              {h.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className={styles.footRow}>
          <Button onClick={() => setAddingProvince(true)}>
            <Plus size={16} />
            Thêm tỉnh/thành phố
          </Button>
        </div>
      </SectionCard>

      {addingProvince && <ProvinceFormDialog open onClose={() => setAddingProvince(false)} />}
      {addingWardTo && (
        <WardFormDialog open province={addingWardTo} onClose={() => setAddingWardTo(null)} />
      )}
      {addingHamletTo && (
        <HamletFormDialog open ward={addingHamletTo} onClose={() => setAddingHamletTo(null)} />
      )}
    </>
  );
}
