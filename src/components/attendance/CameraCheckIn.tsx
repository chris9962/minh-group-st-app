"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, SwitchCamera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  addMyCheck,
  createAttendanceCheck,
  fetchPlaceName,
  slotLabel,
  type AttendanceSlot,
} from "@/lib/api/attendance";
import { uploadImage } from "@/lib/api/uploads";
import { clockNowVn, formatDate } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { useDialogLayer } from "@/store/dialogLayer";
import styles from "./CameraCheckIn.module.scss";

type Position = { latitude: number; longitude: number; accuracy: number };
type Shot = { file: File; preview: string };

const CAMERA_ERROR = "Không mở được camera. Bạn cho phép trình duyệt dùng camera rồi thử lại.";
const LOCATION_ERROR = "Không lấy được vị trí. Bạn bật vị trí cho trình duyệt rồi thử lại.";

/**
 * Màn chụp toàn màn hình kiểu camera điện thoại, không có đường chọn ảnh từ thư
 * viện. Chỉ mount khi đang chấm công: đóng là tháo component, cleanup tắt camera
 * và GPS.
 *
 * Dùng `<dialog>` riêng thay vì `Dialog`: màn này không có tiêu đề, thân và
 * chân của hộp thoại thường. Vẫn khai báo vào `dialogLayer` để toast nổi lên trên.
 */
export function CameraCheckIn({
  slot,
  workDate,
  onClose,
}: {
  slot: AttendanceSlot;
  /** Ngày chấm bù. Không truyền là ngày của máy chủ. */
  workDate?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [cameraFailed, setCameraFailed] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [locationFailed, setLocationFailed] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);

  const cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia);
  const locationSupported = "geolocation" in navigator;

  // Khoá theo tọa độ làm tròn ~100 m: GPS nhích vài mét không gọi lại dịch vụ tra địa danh.
  const placeKey = position ? `${position.latitude.toFixed(3)},${position.longitude.toFixed(3)}` : null;
  const { data: place } = useQuery({
    queryKey: ["attendance-place", placeKey],
    queryFn: () => fetchPlaceName(position!.latitude, position!.longitude),
    enabled: position !== null,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const { push, pop } = useDialogLayer.getState();
    push(el);
    return () => {
      pop(el);
      if (el.open) el.close();
    };
  }, []);

  useEffect(() => {
    if (!cameraSupported) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      // Không xin độ phân giải thì nhiều máy Android chỉ trả 640 x 480.
      .getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        setCameraFailed(false);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setCameraFailed(true));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraSupported, facing]);

  useEffect(() => {
    if (!locationSupported) return;
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setPosition({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy });
        setLocationFailed(false);
      },
      () => setLocationFailed(true),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [locationSupported]);

  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.preview);
  }, [shot]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setShot({
          file: new File([blob], `cham-cong-${slot}.jpg`, { type: "image/jpeg" }),
          preview: URL.createObjectURL(blob),
        });
      },
      "image/jpeg",
      0.9,
    );
  };

  const queryClient = useQueryClient();
  const submit = useMutation({
    mutationFn: async ({ file, at }: { file: File; at: Position }) => {
      const photoUrl = await uploadImage(file, "attendance");
      return createAttendanceCheck({ slot, photoUrl, workDate, ...at });
    },
    onSuccess: (check) => {
      addMyCheck(queryClient, check);
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.ok(
        `Đã chấm công ${slotLabel(slot)}${workDate ? ` ngày ${formatDate(workDate)}` : ""} lúc ${clockNowVn(new Date(check.checkedAt)).slice(0, 5)}`,
      );
      onClose();
    },
    onError: (e) => {
      // Máy chủ từ chối thì tải lại lượt đã chấm, để lịch khớp với dữ liệu thật.
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast.fail(errorMessage(e, "Không lưu được lượt chấm công."));
    },
  });

  const cameraError = !cameraSupported || cameraFailed;
  const locationError = !locationSupported || (locationFailed && !position);

  return (
    <dialog
      ref={dialogRef}
      className={styles.camera}
      aria-label={`Chấm công ${slotLabel(slot)}`}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!submit.isPending) onClose();
      }}
    >
      <header className={styles.top}>
        <button
          type="button"
          className={styles.round}
          aria-label="Đóng"
          disabled={submit.isPending}
          onClick={onClose}
        >
          <X size={20} aria-hidden />
        </button>
        <span className={styles.slot}>
          {slotLabel(slot)}
          {workDate && ` - ${formatDate(workDate)}`}
        </span>
      </header>

      <div className={styles.viewfinder}>
        <video ref={videoRef} className={styles.media} hidden={Boolean(shot)} autoPlay playsInline muted />
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh là blob vừa chụp, next/image không tối ưu được
          <img src={shot.preview} alt={`Ảnh chấm công ${slotLabel(slot)}`} className={styles.media} />
        )}
        <span className={styles.location}>
          <MapPin size={14} aria-hidden />
          {position ? (place ?? "Đã có vị trí") : locationError ? "Chưa có vị trí" : "Đang lấy vị trí…"}
        </span>
        {(cameraError || locationError) && (
          <div className={styles.notices} role="alert">
            {cameraError && <p>{CAMERA_ERROR}</p>}
            {locationError && <p>{LOCATION_ERROR}</p>}
          </div>
        )}
      </div>

      <footer className={styles.bottom}>
        {shot ? (
          <>
            <button
              type="button"
              className={styles.textButton}
              disabled={submit.isPending}
              onClick={() => setShot(null)}
            >
              Chụp lại
            </button>
            <span />
            <button
              type="button"
              className={styles.confirm}
              disabled={!position || submit.isPending}
              onClick={() => position && submit.mutate({ file: shot.file, at: position })}
            >
              {submit.isPending ? "Đang gửi…" : "Chấm công"}
            </button>
          </>
        ) : (
          <>
            <span />
            <button
              type="button"
              className={styles.shutter}
              aria-label="Chụp"
              disabled={cameraError}
              onClick={capture}
            >
              <span className={styles.shutterInner} />
            </button>
            <button
              type="button"
              className={styles.round}
              aria-label="Đổi camera"
              disabled={cameraError}
              onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            >
              <SwitchCamera size={20} aria-hidden />
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}
