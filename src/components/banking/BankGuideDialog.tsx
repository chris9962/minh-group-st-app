"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { Bank } from "@/lib/api/bankCatalog";
import styles from "./BankGuideDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Mã ngân hàng — lên tiêu đề, để người đọc biết đang xem quy trình của ai. */
  bankCode: string;
  /** Bản Thường, chữ tự do nhiều dòng. `''` = chưa có hướng dẫn bản này. */
  guide: string;
  /** Ảnh mẫu, ĐÚNG thứ tự người nhập xếp — khớp "Ảnh 1 · Ảnh 2…" trong `guide`. */
  photoUrls: string[];
  /**
   * Bản CNKD/HKD, để nơi gọi bày cả ba bản trong một hộp thoại.
   *
   * Bỏ trống ở bước 2 của màn mở tài khoản: chỗ đó máy chủ đã chọn sẵn ĐÚNG bản
   * của loại tài khoản đang mở, người điền không có gì để chuyển qua lại.
   */
  variants?: Bank["guideVariants"];
};

/**
 * Xem hướng dẫn mở tài khoản của một ngân hàng.
 *
 * Chỉ ĐỌC. Sửa thì vào hộp thoại ngân hàng ở màn Ngân hàng & mã giới thiệu.
 *
 * Dùng chung cho bước 2 của màn mở tài khoản và bảng ngân hàng: cùng một nội
 * dung, và hai bản riêng thì sớm muộn một bản quên cập nhật.
 */
export function BankGuideDialog({ open, onClose, bankCode, guide, photoUrls, variants = [] }: Props) {
  /** Ảnh đang xem cỡ lớn; `null` = không mở. */
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [tab, setTab] = useState("none");

  /**
   * Chỉ giữ bản CÓ nội dung. Ba bản tách hẳn nhau (chốt 2026-09-02) nên bản
   * trống không có gì để xem, mà bày tab rỗng ra là mời người dùng bấm để biết
   * rằng không có gì.
   */
  const sections = [
    { value: "none", label: "Thường", guide, photoUrls },
    ...variants.map((v) => ({
      value: v.accountType,
      label: v.accountType,
      guide: v.guide,
      photoUrls: v.guidePhotoUrls,
    })),
  ].filter((s) => s.guide !== "" || s.photoUrls.length > 0);

  // Ngân hàng chỉ cấu hình CNKD/HKD thì bản Thường đã bị lọc, tab mặc định
  // không khớp bản nào — lấy bản đầu còn lại.
  const active = sections.find((s) => s.value === tab) ?? sections[0];
  const shownPhotos = active?.photoUrls ?? [];

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={`Hướng dẫn mở tài khoản ${bankCode}`}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        }
      >
        {sections.length > 1 && (
          <div className={styles.typeTabs}>
            <SegmentedTabs
              label="Bản hướng dẫn theo loại tài khoản"
              options={sections.map((s) => ({ value: s.value, label: s.label }))}
              value={active.value}
              // Số thứ tự ảnh thuộc về bản đang xem, nên ảnh phóng to phải đóng
              // lại khi đổi bản — không thì nó chỉ sang ảnh khác cùng vị trí.
              onChange={(v) => {
                setTab(v);
                setZoomed(null);
              }}
            />
          </div>
        )}

        {active?.guide ? (
          /*
            `white-space: pre-wrap` giữ nguyên xuống dòng người nhập gõ.

            Không dựng markdown: nội dung là các bước đánh số tay, mà một bộ
            markdown kéo theo cả bảng, liên kết và mã nhúng — thứ không ai cần ở
            đây và là chỗ dán vào được thẻ lạ.
          */
          <p className={styles.guide}>{active.guide}</p>
        ) : (
          <p className={styles.empty}>
            Ngân hàng này chưa có hướng dẫn. Người quản ngân hàng thêm được ở màn
            Ngân hàng &amp; mã giới thiệu.
          </p>
        )}

        {shownPhotos.length > 0 && (
          <div className={styles.photos}>
            {shownPhotos.map((url, i) => (
              <button
                key={url}
                type="button"
                className={styles.photoZoom}
                aria-label={`Xem ảnh mẫu ${i + 1} cỡ lớn`}
                onClick={() => setZoomed(i)}
              >
                {/* Số thứ tự hiện ngay trên ảnh: đoạn hướng dẫn gọi tên chúng là
                    "Ảnh 1", "Ảnh 2" — không đánh số thì người đọc phải tự đếm. */}
                <span className={styles.photoIndex}>{i + 1}</span>
                <img src={url} alt={`Ảnh mẫu ${i + 1}`} className={styles.photo} />
              </button>
            ))}
          </div>
        )}
      </Dialog>

      {zoomed !== null && (
        <ImageLightbox
          src={shownPhotos[zoomed]}
          alt={`Ảnh mẫu ${zoomed + 1} của ${bankCode}`}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}
