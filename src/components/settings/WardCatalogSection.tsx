"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SearchField } from "@/components/ui/SearchField";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { deleteHamlet, fetchProvinces, type Hamlet, type Ward } from "@/lib/api/wardCatalog";
import { formatPhone, matchesSearch } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { HamletFormDialog } from "./HamletFormDialog";
import { ProvinceFormDialog } from "./ProvinceFormDialog";
import { WardFormDialog } from "./WardFormDialog";
import { WardInfoDialog } from "./WardInfoDialog";
import styles from "./WardCatalogSection.module.scss";

const matchesWard = (w: Ward, query: string): boolean =>
  matchesSearch(w.name, query) ||
  matchesSearch(w.leaderName, query) ||
  w.hamlets.some((h) => matchesSearch(h.name, query) || matchesSearch(h.leaderName, query));

const Missing = () => <span className="text-muted">Chưa có</span>;

/**
 * P-71 · Danh mục xã / ấp — cây BA cấp Tỉnh/thành phố → Xã/phường → Ấp/khu
 * vực (spec §2.4). Danh mục bắt đầu rỗng — quản lý tự "triển khai" từng
 * tỉnh/xã một, chỉ những tỉnh/xã đã thêm ở đây mới hiện ra khi mở tài khoản
 * ngân hàng.
 *
 * Bố cục CHỌN-RỒI-XEM (chốt 2026-09-07): một tỉnh mở tại một thời điểm, danh
 * sách xã bên trái, ấp của xã đang chọn bên phải. Bản trước vẽ cả cây ra một
 * lượt — 39 xã và 123 ấp thành một cột thẻ lồng nhau dài mấy màn, không nhìn
 * ra xã nào đang có bao nhiêu ấp.
 */
export function WardCatalogSection() {
  const [provinceId, setProvinceId] = useState<string | null>(null);
  const [wardId, setWardId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [addingProvince, setAddingProvince] = useState(false);
  const [addingWard, setAddingWard] = useState(false);
  const [editingWard, setEditingWard] = useState(false);
  const [addingHamlet, setAddingHamlet] = useState(false);
  const [editingHamlet, setEditingHamlet] = useState<Hamlet | null>(null);
  const [deletingHamlet, setDeletingHamlet] = useState<Hamlet | null>(null);
  const queryClient = useQueryClient();

  const removeHamlet = useMutation({
    mutationFn: deleteHamlet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provinces"] });
      setDeletingHamlet(null);
      toast.ok("Đã xoá ấp");
    },
    onError: (e) => toast.fail(errorMessage(e, "Không xoá được ấp này.")),
  });

  const { data: provinces = [], isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["provinces"],
    queryFn: fetchProvinces,
  });

  /**
   * Tỉnh và xã đang chọn suy ra từ id + dữ liệu, không lưu cả đối tượng: sau
   * mỗi lần lưu, cây nạp lại và đối tượng cũ đã lỗi thời. Id không khớp gì
   * (tỉnh vừa đổi, xã vừa bị lọc) thì rơi về dòng đầu.
   */
  const province = provinces.find((p) => p.id === provinceId) ?? provinces[0] ?? null;
  const query = search.trim();
  const wardsShown = province
    ? query
      ? province.wards.filter((w) => matchesWard(w, query))
      : province.wards
    : [];
  const ward = province?.wards.find((w) => w.id === wardId) ?? wardsShown[0] ?? null;

  const wardCount = provinces.reduce((n, p) => n + p.wards.length, 0);
  const hamletCount = provinces.reduce(
    (n, p) => n + p.wards.reduce((m, w) => m + w.hamlets.length, 0),
    0,
  );

  const hamletColumns: RankColumn<Hamlet>[] = [
    { key: "name", label: "Ấp", sortText: (h) => h.name, render: (h) => h.name },
    {
      key: "leaderName",
      label: "Trưởng ấp",
      sortText: (h) => h.leaderName,
      render: (h) => h.leaderName || <Missing />,
    },
    {
      key: "leaderPhone",
      label: "Số điện thoại",
      render: (h) => (h.leaderPhone ? formatPhone(h.leaderPhone) : <Missing />),
    },
    {
      key: "actions",
      label: "Thao tác",
      render: (h) => (
        <RowActions>
          <Button
            variant="secondary"
            icon
            tooltip="Sửa ấp"
            aria-label={`Sửa ấp ${h.name}`}
            onClick={() => setEditingHamlet(h)}
          >
            <Pencil size={14} aria-hidden />
          </Button>
          <Button
            variant="secondary"
            icon
            tooltip="Xoá ấp"
            aria-label={`Xoá ấp ${h.name}`}
            onClick={() => setDeletingHamlet(h)}
          >
            <Trash2 size={14} aria-hidden />
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <SectionCard
        title="Danh mục tỉnh / xã / ấp"
        icon={<MapPin size={17} />}
        meta={isPending ? undefined : `${provinces.length} tỉnh - ${wardCount} xã - ${hamletCount} ấp`}
        action={
          <Button variant="secondary" onClick={() => setAddingProvince(true)}>
            <Plus size={14} />
            Thêm tỉnh/thành phố
          </Button>
        }
      >
        {isPending && <SkeletonTable rows={5} columns={4} />}
        {isError && (
          <ErrorState what="danh mục tỉnh/xã/ấp" onRetry={refetch} retrying={isFetching} />
        )}
        {!isPending && !isError && provinces.length === 0 && (
          <p className="text-muted">
            Chưa triển khai tỉnh/thành phố nào. Bấm &quot;Thêm tỉnh/thành phố&quot; ở góc trên.
          </p>
        )}

        {province && (
          <>
            <SegmentedTabs
              label="Tỉnh/thành phố"
              options={provinces.map((p) => ({ value: p.id, label: p.name, count: p.wards.length }))}
              value={province.id}
              onChange={(id) => {
                setProvinceId(id);
                // Xã đang chọn thuộc tỉnh cũ — bỏ để rơi về xã đầu của tỉnh mới.
                setWardId(null);
              }}
            />

            <div className={styles.split}>
              <div className={styles.wardPane}>
                <SearchField
                  label="Tìm xã, ấp hoặc tên trưởng ấp"
                  placeholder="Tân Hưng, Ấp 2, Nguyễn Văn A…"
                  value={search}
                  onChange={setSearch}
                />

                {province.wards.length === 0 && <p className="text-muted">Chưa có xã/phường nào.</p>}
                {province.wards.length > 0 && wardsShown.length === 0 && (
                  <p className="text-muted">Không tìm thấy gì khớp &quot;{search}&quot;.</p>
                )}

                {wardsShown.length > 0 && (
                  <ul className={styles.wardList} aria-label={`Xã/phường của ${province.name}`}>
                    {wardsShown.map((w) => {
                      const active = ward?.id === w.id;
                      return (
                        <li key={w.id}>
                          <button
                            type="button"
                            className={clsx(styles.wardItem, active && styles.wardItemActive)}
                            aria-current={active ? "true" : undefined}
                            onClick={() => setWardId(w.id)}
                          >
                            <span className={styles.wardItemName}>{w.name}</span>
                            <span className={styles.wardItemMeta}>
                              {w.hamlets.length} ấp
                              {w.leaderName && ` - ${w.leaderName}`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className={styles.footRow}>
                  <Button variant="secondary" onClick={() => setAddingWard(true)}>
                    <Plus size={14} />
                    Thêm xã/phường
                  </Button>
                </div>
              </div>

              {ward && (
                <div className={styles.detailPane}>
                  <div className={styles.detailHead}>
                    <div>
                      <h3 className={styles.detailTitle}>{ward.name}</h3>
                      <p className={styles.detailSub}>{province.name}</p>
                    </div>
                    <Button variant="secondary" onClick={() => setEditingWard(true)}>
                      <Pencil size={14} aria-hidden />
                      Sửa trưởng xã
                    </Button>
                  </div>

                  <dl className={styles.facts}>
                    <div>
                      <dt>Trưởng xã</dt>
                      <dd>{ward.leaderName || <Missing />}</dd>
                    </div>
                    <div>
                      <dt>Số điện thoại</dt>
                      <dd>{ward.leaderPhone ? formatPhone(ward.leaderPhone) : <Missing />}</dd>
                    </div>
                  </dl>

                  <RankTable
                    rows={ward.hamlets}
                    columns={hamletColumns}
                    rowKey={(h) => h.id}
                    defaultSort="name"
                    caption={`Ấp của ${ward.name}`}
                    emptyText="Chưa có ấp nào. Bấm “Thêm ấp” bên dưới."
                  />

                  <div className={styles.footRow}>
                    <Button onClick={() => setAddingHamlet(true)}>
                      <Plus size={16} />
                      Thêm ấp
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SectionCard>

      {addingProvince && <ProvinceFormDialog open onClose={() => setAddingProvince(false)} />}
      {addingWard && province && (
        <WardFormDialog open province={province} onClose={() => setAddingWard(false)} />
      )}
      {editingWard && ward && (
        <WardInfoDialog open ward={ward} onClose={() => setEditingWard(false)} />
      )}
      {addingHamlet && ward && (
        <HamletFormDialog open ward={ward} onClose={() => setAddingHamlet(false)} />
      )}
      {editingHamlet && ward && (
        <HamletFormDialog
          open
          ward={ward}
          hamlet={editingHamlet}
          onClose={() => setEditingHamlet(null)}
        />
      )}
      {deletingHamlet && (
        <ConfirmDialog
          open
          title="Xoá ấp"
          confirmLabel="Xoá ấp"
          pending={removeHamlet.isPending}
          onConfirm={() => removeHamlet.mutate(deletingHamlet.id)}
          onClose={() => setDeletingHamlet(null)}
          consequence="Hồ sơ cũ gắn ấp này giữ nguyên tên đã lưu; ô chọn ấp không hiện tên này nữa."
        >
          Xoá ấp {deletingHamlet.name}?
        </ConfirmDialog>
      )}
    </>
  );
}
