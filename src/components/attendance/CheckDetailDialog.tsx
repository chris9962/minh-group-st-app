"use client";

import { clsx } from "clsx";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import type { AttendanceCheck } from "@/lib/api/attendance";
import { formatDateTime } from "@/lib/format";
import styles from "./CheckDetailDialog.module.scss";

const mapEmbedUrl = (c: AttendanceCheck) =>
  `https://maps.google.com/maps?q=${c.latitude},${c.longitude}&z=17&output=embed`;

/**
 * Nơi gọi đặt `key={check.id}` để trạng thái đã tải đặt lại khi đổi lượt. Lượt
 * điểm danh không ảnh chỉ có giờ, nơi chấm và bản đồ.
 */
export function CheckDetailDialog({
  check,
  title,
  onClose,
}: {
  check: AttendanceCheck;
  title: string;
  onClose: () => void;
}) {
  const [photoLoaded, setPhotoLoaded] = useState(!check.photoUrl);
  const [mapLoaded, setMapLoaded] = useState(false);
  const stamp = formatDateTime(check.checkedAt);

  return (
    <Dialog open narrow title={title} onClose={onClose}>
      <div className={clsx(styles.body, !check.photoUrl && styles.bodyNoPhoto)} aria-busy={!photoLoaded || !mapLoaded}>
        {check.photoUrl ? (
          <div className={styles.photoWrap}>
            {!photoLoaded && <Skeleton className={styles.skeleton} />}
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh đi qua /api/images có kiểm phiên, next/image không tối ưu được */}
            <img
              src={check.photoUrl}
              alt={title}
              className={styles.photo}
              onLoad={() => setPhotoLoaded(true)}
              onError={() => setPhotoLoaded(true)}
            />
            {photoLoaded && (
              <div className={styles.stamp}>
                <div className={styles.clock}>
                  <span className={styles.time}>{stamp.slice(11)}</span>
                  <span className={styles.date}>{stamp.slice(0, 10)}</span>
                </div>
                {check.place && (
                  <div className={styles.place}>
                    <MapPin size={13} aria-hidden />
                    {check.place}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.textStamp}>
            <div className={styles.clock}>
              <span className={styles.time}>{stamp.slice(11)}</span>
              <span className={styles.textDate}>{stamp.slice(0, 10)}</span>
            </div>
            {check.place && (
              <div className={styles.place}>
                <MapPin size={13} aria-hidden />
                {check.place}
              </div>
            )}
          </div>
        )}
        <div className={clsx(styles.mapWrap, !check.photoUrl && styles.mapTall)}>
          {!mapLoaded && <Skeleton className={styles.skeleton} />}
          <iframe
            src={mapEmbedUrl(check)}
            title={`Bản đồ vị trí ${title}`}
            className={styles.map}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => setMapLoaded(true)}
          />
        </div>
      </div>
    </Dialog>
  );
}
