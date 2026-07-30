"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { fetchWards, type Ward } from "@/lib/api/wardCatalog";
import { matchesSearch } from "@/lib/format";
import { HamletFormDialog } from "./HamletFormDialog";
import { WardFormDialog } from "./WardFormDialog";
import styles from "./WardCatalogSection.module.scss";

/**
 * P-71 · Danh mục xã / ấp — cây hai cấp (spec §2.4), dùng cho kênh Ấp và
 * Định danh: chọn xã trước, hiện đúng ấp của xã đó.
 */
export function WardCatalogSection() {
  const [creatingWard, setCreatingWard] = useState(false);
  const [addingHamletTo, setAddingHamletTo] = useState<Ward | null>(null);
  const [search, setSearch] = useState("");

  const { data: wards = [], isPending, isError } = useQuery({
    queryKey: ["wards"],
    queryFn: fetchWards,
  });

  // Tìm theo tên xã HOẶC tên ấp — gõ "tân hoà a" vẫn ra đúng xã chứa ấp đó.
  const visibleWards = useMemo(
    () =>
      search.trim()
        ? wards.filter(
            (w) => matchesSearch(w.name, search) || w.hamlets.some((h) => matchesSearch(h.name, search)),
          )
        : wards,
    [wards, search],
  );

  return (
    <>
      <SectionCard title="Danh mục xã / ấp" icon={<MapPin size={17} />} meta={`${wards.length} xã`}>
        <SearchField
          label="Tìm xã hoặc ấp"
          placeholder="Tân Bình, Ấp 2…"
          value={search}
          onChange={setSearch}
        />

        {isPending && <p className="text-muted">Đang tải danh sách…</p>}
        {isError && <p className="text-muted">Không tải được danh mục xã/ấp.</p>}
        {!isPending && !isError && wards.length === 0 && (
          <p className="text-muted">Chưa có xã nào.</p>
        )}
        {!isPending && !isError && wards.length > 0 && visibleWards.length === 0 && (
          <p className="text-muted">Không tìm thấy xã/ấp nào khớp &quot;{search}&quot;.</p>
        )}

        <div className={styles.wards}>
          {visibleWards.map((ward) => (
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

        <div className={styles.footRow}>
          <Button onClick={() => setCreatingWard(true)}>
            <Plus size={16} />
            Thêm xã
          </Button>
        </div>

        <p className={styles.footnote}>
          Dùng cho kênh <strong>Ấp</strong> và <strong>Định danh</strong> ở P-20 — KD chọn xã
          trước, app tự lọc đúng ấp của xã đó.
        </p>
      </SectionCard>

      {creatingWard && <WardFormDialog open onClose={() => setCreatingWard(false)} />}
      {addingHamletTo && (
        <HamletFormDialog open ward={addingHamletTo} onClose={() => setAddingHamletTo(null)} />
      )}
    </>
  );
}
