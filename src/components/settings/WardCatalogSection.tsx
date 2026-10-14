"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  deleteHamlet,
  fetchProvinces,
  type Hamlet,
  type HamletContact,
  type Ward,
} from "@/lib/api/wardCatalog";
import { EXCEL_GROUP_COLORS, exportExcel, type ExcelColumn } from "@/lib/excel";
import { formatPhone, nameForExcel } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { HamletFormDialog } from "./HamletFormDialog";
import { ProvinceFormDialog } from "./ProvinceFormDialog";
import { WardFormDialog } from "./WardFormDialog";
import { WardInfoDialog } from "./WardInfoDialog";
import styles from "./WardCatalogSection.module.scss";

const Missing = () => <span className="text-muted">Chưa có</span>;

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** "Trưởng ấp: Nguyễn Văn A - 0901 234 567"; thiếu vế nào thì bỏ vế đó. */
const contactLine = (c: HamletContact): string => {
  const who = [c.title, c.name].filter(Boolean).join(": ");
  return [who, c.phone ? formatPhone(c.phone) : ""].filter(Boolean).join(" - ");
};

/** Một dòng file Excel: mỗi người liên hệ một dòng, ấp chưa có ai vẫn một dòng. */
type HamletExportRow = { hamlet: Hamlet; contact: HamletContact | null };

/**
 * Xuất ấp và người liên hệ của MỘT xã (chốt 2026-10-14). Dữ liệu lấy từ cây đã
 * tải: danh mục đóng, vài chục ấp mỗi xã, không cần route xuất riêng
 * (AGENTS.md §5.1). Đầu bảng 3 tầng theo §12.
 */
async function exportHamlets(ward: Ward, provinceName: string): Promise<void> {
  const rows = ward.hamlets.flatMap((hamlet): HamletExportRow[] =>
    hamlet.contacts.length === 0
      ? [{ hamlet, contact: null }]
      : hamlet.contacts.map((contact) => ({ hamlet, contact })),
  );
  const columns: ExcelColumn<HamletExportRow>[] = [
    { header: "STT", group: "ẤP", width: 7, type: "number", align: "center", total: (all) => all.length, value: (_r, i) => i + 1 },
    { header: "ẤP", group: "ẤP", width: 24, value: (r) => r.hamlet.name },
    { header: "XÃ/PHƯỜNG", group: "ẤP", width: 24, value: () => ward.name },
    { header: "TỈNH/THÀNH PHỐ", group: "ẤP", width: 20, value: () => provinceName },
    { header: "CHỨC VỤ", group: "LIÊN HỆ", width: 18, value: (r) => r.contact?.title ?? "" },
    { header: "HỌ TÊN", group: "LIÊN HỆ", width: 28, value: (r) => r.contact?.name ?? "" },
    { header: "SỐ ĐIỆN THOẠI", group: "LIÊN HỆ", width: 16, type: "text", value: (r) => r.contact?.phone ?? "" },
    { header: "NGƯỜI TẠO", group: "NHÂN SỰ", groupColor: EXCEL_GROUP_COLORS.staff, width: 24, value: (r) => r.hamlet.createdByName ?? "" },
  ];
  await exportExcel({
    fileName: `ap-${nameForExcel(ward.name).toLowerCase().replace(/\s+/g, "-")}-${iso(new Date())}.xlsx`,
    sheetName: "Ấp",
    columns,
    rows,
  });
}

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

  const xuatExcel = async () => {
    if (!ward || !province) return;
    try {
      await exportHamlets(ward, province.name);
    } catch (e) {
      toast.fail(errorMessage(e, "Không xuất được file"));
    }
  };

  const hamletColumns: RankColumn<Hamlet>[] = [
    { key: "name", label: "Ấp", sortText: (h) => h.name, render: (h) => h.name },
    {
      key: "contacts",
      label: "Liên hệ",
      sortText: (h) => h.contacts[0]?.name ?? "",
      render: (h) =>
        h.contacts.length === 0 ? (
          <Missing />
        ) : (
          <ul className={styles.contactList}>
            {h.contacts.map((c) => (
              <li key={c.id}>{contactLine(c)}</li>
            ))}
          </ul>
        ),
    },
    {
      key: "createdByName",
      label: "Người tạo",
      sortText: (h) => h.createdByName ?? "",
      render: (h) => h.createdByName ?? <span className="text-muted">—</span>,
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
              <div className={styles.detailActions}>
                <Button
                  variant="secondary"
                  aria-label="Xuất Excel ấp của xã này"
                  disabled={ward.hamlets.length === 0}
                  onClick={() => void xuatExcel()}
                >
                  <Download size={16} aria-hidden />
                  <span className={buttonStyles.label}>Xuất Excel</span>
                </Button>
                <Button onClick={() => setAddingHamlet(true)}>
                  <Plus size={16} />
                  Thêm ấp
                </Button>
              </div>
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
