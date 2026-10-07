"use client";

import { AlertCircle, CameraOff, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { imageProblem } from "@/lib/api/uploads";
import { ID_CARD_QR_UNREADABLE, parseIdCardQr, type IdCardQr } from "@/lib/idCardQr";
import { readQrImage } from "@/lib/readQrImage";
import styles from "./IdCardScanner.module.scss";

export type ScannedIdCard = Extract<IdCardQr, { ok: true }>;

type Props = {
  /** Thẻ đọc xong: ba trường từ QR và file ảnh (khung hình vừa chụp, hoặc ảnh đã chọn) để gửi lên máy chủ. */
  onScanned: (card: ScannedIdCard, file: File) => void;
  /** Nút Huỷ nằm ngay trên khung ngắm, thay cho chân hộp thoại ở bước này. */
  onCancel: () => void;
};

type Shot = { file: File; preview: string };

const CAMERA_FAILED = "Không mở được camera. Bạn cho phép trình duyệt dùng camera rồi bấm Thử lại.";
/** Giữ khung xanh một nhịp để người dùng thấy thẻ đã đọc được trước khi form hiện ra. */
const DONE_FLASH_MS = 350;

/** `mediaDevices` chỉ có trên HTTPS hoặc localhost; thiếu nó là không hỏi được camera. */
const cameraAvailable = () =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Bước 1 của form tạo khách (chốt 2026-10-06): khung ngắm kiểu camera điện
 * thoại ngay trong hộp thoại, cùng lối với `CameraCheckIn`. Người dùng đưa thẻ
 * vào khung rồi bấm nút chụp tròn. Khung hình chụp ở độ phân giải gốc của video
 * thành file JPEG; trình duyệt đọc QR từ file đó để điền sẵn ba ô, và chính file
 * đó gửi lên máy chủ để đọc lại.
 *
 * Ảnh vừa chụp hiện đè lên video trong lúc đọc, để người dùng thấy đúng tấm sẽ
 * lưu. Đọc hỏng thì bỏ ảnh, video chạy tiếp, bấm chụp lại.
 *
 * KHÔNG có đường chọn ảnh từ thư viện (chủ dự án chốt 2026-10-06): ảnh thẻ phải
 * chụp tại chỗ. Không mở được camera thì chỉ còn nút Thử lại.
 */
export function IdCardScanner({ onScanned, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const alive = useRef(false);
  const [camera, setCamera] = useState<"starting" | "live" | "failed">(() =>
    cameraAvailable() ? "starting" : "failed",
  );
  const [error, setError] = useState<string | null>(() =>
    cameraAvailable() ? null : CAMERA_FAILED,
  );
  const [attempt, setAttempt] = useState(0);
  const [shot, setShot] = useState<Shot | null>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "error" | "done">("idle");

  // Khung xanh đợi một nhịp rồi mới báo lên cha; đóng hộp thoại giữa chừng thì
  // bỏ lượt báo đó. Gán lại `true` lúc gắn vì StrictMode gỡ rồi gắn lại effect.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * Camera là hệ thống ngoài React nên đi qua effect, và cleanup phải `stop()`
   * mọi track: đóng hộp thoại, bấm Huỷ, sang bước 2 hay unmount đều tắt đèn
   * camera. "Chụp lại" ở bước 2 gắn lại component nên camera mở lại; nút Thử
   * lại tăng `attempt` để hỏi camera lần nữa sau khi người dùng cấp quyền.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cameraAvailable()) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    setCamera("starting");
    setError(null);

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((granted) => {
        // Hộp thoại đã đóng trong lúc chờ người dùng cho phép.
        if (cancelled) {
          granted.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = granted;
        video.srcObject = granted;
        // iOS Safari chỉ tự chạy khi có `muted` + `playsInline`; gọi `play()`
        // cho máy không tự chạy, lỗi của nó không có gì để xử lý.
        void video.play().catch(() => {});
        setCamera("live");
      })
      .catch(() => {
        if (cancelled) return;
        setCamera("failed");
        setError(CAMERA_FAILED);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.preview);
  }, [shot]);

  // Đọc hỏng thì giấu camera, chỉ còn câu báo và nút Chụp lại (chốt 2026-10-06).
  // Luồng camera vẫn gắn trên thẻ video, bấm Chụp lại là hình hiện ngay.
  const fail = (message: string) => {
    setError(message);
    setShot(null);
    setPhase("error");
  };

  const retake = () => {
    setError(null);
    setPhase("idle");
  };

  const read = async (file: File) => {
    setError(null);
    setPhase("reading");
    setShot({ file, preview: URL.createObjectURL(file) });

    const problem = imageProblem(file);
    if (problem) {
      fail(problem);
      return;
    }
    const found = await readQrImage(file);
    // Câu lỗi của `readQrImage` viết cho ảnh QR mã giới thiệu ("dán link bằng
    // tay"), ở đây thay bằng câu nói về thẻ.
    const card = found.ok
      ? parseIdCardQr(found.text)
      : { ok: false as const, message: ID_CARD_QR_UNREADABLE };
    if (!card.ok) {
      fail(card.message);
      return;
    }
    setPhase("done");
    window.setTimeout(() => {
      if (alive.current) onScanned(card, file);
    }, DONE_FLASH_MS);
  };

  /** Khung hình hiện tại ở độ phân giải gốc của video, thành file JPEG. */
  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      fail(ID_CARD_QR_UNREADABLE);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          fail(ID_CARD_QR_UNREADABLE);
          return;
        }
        void read(new File([blob], "cccd.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };

  const failed = camera === "failed";
  const reading = phase === "reading";
  const showPanel = failed || phase === "error";
  const tag = reading
    ? "Đang xử lý…"
    : phase === "done"
      ? "Đã đọc thẻ"
      : camera === "starting"
        ? "Đang mở camera…"
        : "Đưa mặt trước thẻ CCCD vào khung";

  return (
    <div className={styles.scanner}>
      <div className={styles.viewport} aria-busy={reading || undefined}>
        {/* Thẻ video luôn có mặt, kể cả lúc giấu đi: luồng camera vẫn gắn
            trên nó, nên Chụp lại và Thử lại không phải mở lại từ đầu. */}
        <video
          ref={videoRef}
          className={styles.media}
          hidden={Boolean(shot) || showPanel}
          autoPlay
          playsInline
          muted
        />
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh là blob vừa chụp, next/image không tối ưu được
          <img src={shot.preview} alt="Ảnh thẻ vừa chụp" className={styles.media} />
        )}

        {showPanel ? (
          <div className={styles.panel} role="alert">
            {failed ? <CameraOff size={32} aria-hidden /> : <AlertCircle size={32} aria-hidden />}
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div
              className={clsx(styles.frame, phase === "done" && styles.frameDone)}
              aria-hidden
            >
              <i />
              <i />
              <i />
              <i />
            </div>
            <span className={styles.tag}>{tag}</span>
            {reading && <span className={styles.progress} aria-hidden />}
          </>
        )}

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.textButton}
            disabled={reading}
            onClick={onCancel}
          >
            Huỷ
          </button>
          {failed ? (
            <button
              type="button"
              className={styles.retry}
              // Không có `mediaDevices` thì hỏi lại cũng vô ích: trang đang mở
              // không qua HTTPS, phải đổi địa chỉ chứ không phải bấm lại.
              disabled={!cameraAvailable()}
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RefreshCw size={18} aria-hidden />
              Thử lại
            </button>
          ) : phase === "error" ? (
            <button type="button" className={styles.retry} onClick={retake}>
              <RefreshCw size={18} aria-hidden />
              Chụp lại
            </button>
          ) : (
            <button
              type="button"
              className={clsx(styles.shutter, reading && styles.shutterBusy)}
              aria-label="Chụp"
              disabled={camera !== "live" || phase !== "idle"}
              onClick={capture}
            >
              <span className={styles.shutterInner} />
            </button>
          )}
          <span />
        </div>
      </div>
    </div>
  );
}
