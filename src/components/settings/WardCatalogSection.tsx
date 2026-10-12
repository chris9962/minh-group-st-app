"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { Combobox } from "@/components/ui/Combobox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RankTable, type RankColumn } from "@/components/ui/RankTable";
import { RowActions } from "@/components/ui/RowActions";
import { SectionCard } from "@/components/ui/SectionCard";
import { deleteHamlet, fetchProvinces, type Hamlet } from "@/lib/api/wardCatalog";
import { formatPhone } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { HamletFormDialog } from "./HamletFormDialog";
import { ProvinceFormDialog } from "./ProvinceFormDialog";
import { WardFormDialog } from "./WardFormDialog";
import { WardInfoDialog } from "./WardInfoDialog";
import styles from "./WardCatalogSection.module.scss";

const Missing = () => <span className="text-muted">Chưa có</span>;

/**
 * P-71 · Danh mục xã / ấp — cây BA cấp Tỉnh/thành phố → Xã/phường → Ấp/khu
 * vực (spec §2.4). Danh mục bắt đầu rỗng — quản lý tự "triển khai" từng
 * tỉnh/xã một, chỉ những tỉnh/xã đã thêm ở đây mới hiện ra khi mở tài khoản
 * ngân hàng.
 *
 * Bố cục CHỌN-RỒI-XEM (chốt 2026-09-07): chọn một tỉnh và một xã bằng ô chọn,
 * ấp của xã đang chọn nằm bên dưới. Bản trước vẽ cả cây ra một lượt — 39 xã và
 * 123 ấp thành một cột thẻ lồng nhau dài mấy màn, không nhìn ra xã nào đang có
 * bao nhiêu ấp. Desktop dùng chung bố cục của điện thoại (chốt 2026-10-12).
 */
export function WardCatalogSection() {
  const [provinceId, setProvinceId] = useState<string | null>(null);
  const [wardId, setWardId] = useState<string | null>(null);
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
   * (tỉnh vừa đổi) thì rơi về dòng đầu.
   */
  const province = provinces.find((p) => p.id === provinceId) ?? provinces[0] ?? null;
  const ward = province?.wards.find((w) => w.id === wardId) ?? province?.wards[0] ?? null;

  const wardCount = provinces.reduce((n, p) => n + p.wards.length, 0);
  const hamletCount = provinces.reduce(
    (n, p) => n + p.wards.reduce((m, w) => m + w.hamlets.length, 0),
    0,
  );

  const selectProvince = (id: string) => {
    setProvinceId(id);
    // Xã đang chọn thuộc tỉnh cũ — bỏ để rơi về xã đầu của tỉnh mới.
    setWardId(null);
  };

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
            aria-label={`Sửa ấp ${h.name}`}
            onClick={() => setEditingHamlet(h)}
          >
            <Pencil size={14} aria-hidden />
            <span className={buttonStyles.label}>Sửa</span>
          </Button>
          <Button
            variant="secondary"
            aria-label={`Xoá ấp ${h.name}`}
            onClick={() => setDeletingHamlet(h)}
          >
            <Trash2 size={14} aria-hidden />
            <span className={buttonStyles.label}>Xoá</span>
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
        stackMeta
      >
        {isPending && <SkeletonTable rows={5} columns={4} />}
        {isError && (
          <ErrorState what="danh mục tỉnh/xã/ấp" onRetry={refetch} retrying={isFetching} />
        )}
        {!isPending && !isError && provinces.length === 0 && (
          <p className="text-muted">Chưa triển khai tỉnh/thành phố nào.</p>
        )}

        {/* Nằm ngoài `province &&` vì nút thêm tỉnh ở đây. */}
        {!isPending && !isError && (
          <div className={styles.pickers}>
            <div className={styles.pickerRow}>
              <div className={styles.picker}>
                <Combobox
                  block
                  label="Tỉnh/thành phố"
                  value={province?.id ?? ""}
                  options={provinces.map((p) => ({
                    value: p.id,
                    label: `${p.name} - ${p.wards.length} xã/phường`,
                  }))}
                  onChange={selectProvince}
                  placeholder="Gõ tên tỉnh/thành phố"
                />
              </div>
              <Button
                variant="secondary"
                aria-label="Thêm tỉnh/thành phố"
                onClick={() => setAddingProvince(true)}
              >
                <Plus size={16} aria-hidden />
                <span className={buttonStyles.label}>Thêm tỉnh/thành phố</span>
              </Button>
            </div>

            {province && (
              <div className={styles.pickerRow}>
                <div className={styles.picker}>
                  <Combobox
                    block
                    label="Xã/phường"
                    value={ward?.id ?? ""}
                    options={province.wards.map((w) => ({
                      value: w.id,
                      label: `${w.name} - ${w.hamlets.length} ấp`,
                    }))}
                    onChange={setWardId}
                    placeholder="Gõ tên xã/phường"
                  />
                </div>
                <Button
                  variant="secondary"
                  aria-label="Thêm xã/phường"
                  onClick={() => setAddingWard(true)}
                >
                  <Plus size={16} aria-hidden />
                  <span className={buttonStyles.label}>Thêm xã/phường</span>
                </Button>
              </div>
            )}
          </div>
        )}

        {province?.wards.length === 0 && <p className="text-muted">Chưa có xã/phường nào.</p>}

        {province && ward && (
          <div className={styles.detailPane}>
            <div className={styles.detailHead}>
              <div>
                <h3 className={styles.detailTitle}>{ward.name}</h3>
                <p className={styles.detailSub}>{province.name}</p>
              </div>
              <Button onClick={() => setAddingHamlet(true)}>
                <Plus size={16} />
                Thêm ấp
              </Button>
            </div>

            {/* Thông tin trưởng xã thu gọn, bấm mới mở (chốt 2026-09-27). */}
            <details className={styles.factsToggle}>
              <summary>Thông tin trưởng xã</summary>
              <div className={styles.factsBody}>
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
                <Button variant="ghost" onClick={() => setEditingWard(true)}>
                  <Pencil size={14} aria-hidden />
                  Sửa trưởng xã
                </Button>
              </div>
            </details>

            <RankTable
              rows={ward.hamlets}
              columns={hamletColumns}
              rowKey={(h) => h.id}
              defaultSort="name"
              caption={`Ấp của ${ward.name}`}
              emptyText="Chưa có ấp nào. Bấm “Thêm ấp” ở trên."
            />
          </div>
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
        >
          Bạn muốn xoá ấp <strong>{deletingHamlet.name}</strong>?
        </ConfirmDialog>
      )}
    </>
  );
}
