"use client";

import { AlertCircle, CameraOff, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import {
  ID_CARD_CROP_MARGIN,
  ID_CARD_QR_UNREADABLE,
  parseIdCardQr,
  type IdCardQr,
} from "@/lib/idCardQr";
import { readQrPixels } from "@/lib/readQrImage";
import styles from "./IdCardScanner.module.scss";

export type ScannedIdCard = Extract<IdCardQr, { ok: true }>;

type Props = {
  /** Thẻ đọc xong: ba trường từ QR và file ảnh thẻ vừa chụp để gửi lên máy chủ. */
  onScanned: (card: ScannedIdCard, file: File) => void;
  /** Nút Huỷ nằm ngay trên khung ngắm, thay cho chân hộp thoại ở bước này. */
  onCancel: () => void;
};

type Shot = { file: File; preview: string };
type Rect = { left: number; top: number; width: number; height: number };

const CAMERA_FAILED = "Không mở được camera. Bạn cho phép trình duyệt dùng camera rồi bấm Thử lại.";
const CAMERA_NO_PICTURE = "Camera không có hình. Bạn tắt các app đang dùng camera rồi bấm Thử lại.";

/**
 * Các mức xin camera, thử lần lượt. 4K trước vì QR trên CCCD mẫu cũ nhỏ, cần
 * nhiều điểm ảnh. Có máy báo có 4K mà camera không gửi hình ở mức đó: luồng mở
 * được nhưng màn đen. Quá `FIRST_FRAME_MS` chưa có hình thì đóng luồng, xin mức
 * kế tiếp; mức cuối không kèm độ phân giải, để máy tự chọn như app camera.
 */
const CAMERA_TRIES: MediaTrackConstraints[] = [
  { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  { facingMode: { ideal: "environment" } },
];
const FIRST_FRAME_MS = 3000;

/** `true` khi video có khung hình đầu tiên trong `ms`. */
const firstFrame = (video: HTMLVideoElement, ms: number) =>
  new Promise<boolean>((resolve) => {
    const started = performance.now();
    const check = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) return resolve(true);
      if (performance.now() - started > ms) return resolve(false);
      window.setTimeout(check, 200);
    };
    check();
  });
/** Giữ khung xanh một nhịp để người dùng thấy thẻ đã đọc được trước khi form hiện ra. */
const DONE_FLASH_MS = 350;
/** Quá lâu không đọc được QR thì viền khung về lại màu trắng. */
const QR_SEEN_MS = 800;
/** Nghỉ giữa hai lượt quét, để máy yếu còn sức vẽ video. */
const SCAN_GAP_MS = 50;
/** Bấm chụp mà khung hình đó không đọc được QR thì thử thêm vài khung kế tiếp. */
const CAPTURE_TRIES = 8;

/** `mediaDevices` chỉ có trên HTTPS hoặc localhost; thiếu nó là không hỏi được camera. */
const cameraAvailable = () =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Ô vuông QR trên màn hình đổi sang toạ độ điểm ảnh của video, cộng viền
 * `ID_CARD_CROP_MARGIN`. Video hiện bằng `object-fit: cover` nên bị phóng và cắt
 * mép: phải đổi toạ độ theo cùng tỉ lệ đó.
 */
function qrRect(video: HTMLVideoElement, viewportEl: HTMLElement, frameEl: HTMLElement): Rect | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0) return null;
  const viewport = viewportEl.getBoundingClientRect();
  const frame = frameEl.getBoundingClientRect();
  const scale = Math.max(viewport.width / vw, viewport.height / vh);
  const offsetX = (viewport.width - vw * scale) / 2;
  const offsetY = (viewport.height - vh * scale) / 2;
  const marginX = frame.width * ID_CARD_CROP_MARGIN;
  const marginY = frame.height * ID_CARD_CROP_MARGIN;
  const left = Math.max(0, (frame.left - viewport.left - marginX - offsetX) / scale);
  const top = Math.max(0, (frame.top - viewport.top - marginY - offsetY) / scale);
  const right = Math.min(vw, (frame.right - viewport.left + marginX - offsetX) / scale);
  const bottom = Math.min(vh, (frame.bottom - viewport.top + marginY - offsetY) / scale);
  return { left, top, width: right - left, height: bottom - top };
}

/** Thẻ đọc được từ chuỗi QR, hoặc `null`; zxing nạp hỏng cũng coi như chưa đọc được. */
async function cardIn(pixels: ImageData): Promise<ScannedIdCard | null> {
  try {
    const text = await readQrPixels(pixels);
    const card = text ? parseIdCardQr(text) : null;
    return card?.ok ? card : null;
  } catch {
    return null;
  }
}

/**
 * Bước 1 của form tạo khách (chốt 2026-10-06): khung ngắm kiểu camera điện
 * thoại ngay trong hộp thoại, cùng lối với `CameraCheckIn`.
 *
 * Khung ngắm chỉ có một ô vuông giữa màn hình, người dùng canh mã QR của thẻ
 * hoặc của app VNeID vào ô đó (chốt 2026-10-08, thay khung cả thẻ vì máy yếu
 * không đọc được QR nhỏ). Trang quét liên tục riêng ô vuông ở độ phân giải gốc
 * của video. Đọc được QR thì viền ô chuyển xanh và nút chụp mở.
 *
 * Bấm chụp: cắt ô vuông của MỘT khung hình thành file JPEG, đọc QR ngay trên
 * khung hình đó, nên ảnh gửi lên máy chủ chắc chắn chứa đúng QR đã đọc.
 *
 * KHÔNG có đường chọn ảnh từ thư viện (chủ dự án chốt 2026-10-06): ảnh thẻ phải
 * chụp tại chỗ. Không mở được camera thì chỉ còn nút Thử lại.
 */
export function IdCardScanner({ onScanned, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
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
  const [qrSeen, setQrSeen] = useState(false);

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

    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      video.srcObject = null;
    };

    const open = async () => {
      for (const constraints of CAMERA_TRIES) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
        } catch {
          if (cancelled) return;
          setCamera("failed");
          setError(CAMERA_FAILED);
          return;
        }
        // Hộp thoại đã đóng trong lúc chờ người dùng cho phép.
        if (cancelled) return stop();
        video.srcObject = stream;
        // iOS Safari chỉ tự chạy khi có `muted` + `playsInline`; gọi `play()`
        // cho máy không tự chạy, lỗi của nó không có gì để xử lý.
        void video.play().catch(() => {});
        if (await firstFrame(video, FIRST_FRAME_MS)) {
          if (!cancelled) setCamera("live");
          return;
        }
        stop();
        if (cancelled) return;
      }
      setCamera("failed");
      setError(CAMERA_NO_PICTURE);
    };
    void open();

    return () => {
      cancelled = true;
      stop();
    };
  }, [attempt]);

  // Quét ô vuông liên tục trong lúc người dùng canh QR; dừng khi đang chụp hay đã chụp.
  useEffect(() => {
    const video = videoRef.current;
    const viewport = viewportRef.current;
    const frame = frameRef.current;
    if (camera !== "live" || phase !== "idle" || !video || !viewport || !frame) return;
    let stopped = false;
    let lastSeen = 0;
    let timer = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scan = async () => {
      const qr = qrRect(video, viewport, frame);
      if (qr && ctx) {
        canvas.width = Math.round(qr.width);
        canvas.height = Math.round(qr.height);
        ctx.drawImage(video, qr.left, qr.top, qr.width, qr.height, 0, 0, canvas.width, canvas.height);
        if (await cardIn(ctx.getImageData(0, 0, canvas.width, canvas.height))) lastSeen = performance.now();
      }
      if (stopped) return;
      setQrSeen(performance.now() - lastSeen < QR_SEEN_MS);
      timer = window.setTimeout(scan, SCAN_GAP_MS);
    };
    void scan();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [camera, phase]);

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
    setQrSeen(false);
    setPhase("idle");
  };

  /** Cắt ô vuông của khung hình hiện tại và đọc QR trên chính khung hình đó. */
  const grab = async (): Promise<{ canvas: HTMLCanvasElement; card: ScannedIdCard } | null> => {
    const video = videoRef.current;
    const viewport = viewportRef.current;
    const frame = frameRef.current;
    const rect = video && viewport && frame ? qrRect(video, viewport, frame) : null;
    if (!video || !rect) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, rect.left, rect.top, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    const card = await cardIn(ctx.getImageData(0, 0, canvas.width, canvas.height));
    return card ? { canvas, card } : null;
  };

  const capture = async () => {
    setError(null);
    setPhase("reading");
    let got: Awaited<ReturnType<typeof grab>> = null;
    for (let i = 0; i < CAPTURE_TRIES && !got; i++) {
      if (i > 0) await new Promise((r) => requestAnimationFrame(r));
      got = await grab();
    }
    if (!got) {
      fail(ID_CARD_QR_UNREADABLE);
      return;
    }
    const { canvas, card } = got;
    // Chất lượng 0.95: máy chủ đọc lại QR trên chính file này, nén mạnh hơn là mất ô.
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.95));
    if (!blob) {
      fail(ID_CARD_QR_UNREADABLE);
      return;
    }
    const file = new File([blob], "cccd.jpg", { type: "image/jpeg" });
    setShot({ file, preview: URL.createObjectURL(file) });
    setPhase("done");
    window.setTimeout(() => {
      if (alive.current) onScanned(card, file);
    }, DONE_FLASH_MS);
  };

  const failed = camera === "failed";
  const reading = phase === "reading";
  const showPanel = failed || phase === "error";
  const ready = phase === "idle" && qrSeen;
  const tag = reading
    ? "Đang xử lý…"
    : phase === "done"
      ? "Đã đọc"
      : camera === "starting"
        ? "Đang mở camera…"
        : ready
          ? "Đã thấy mã QR"
          : "Đưa mã QR vào ô vuông";

  return (
    <div className={styles.scanner}>
      <div ref={viewportRef} className={styles.viewport} aria-busy={reading || undefined}>
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
          <img src={shot.preview} alt="Ảnh mã QR vừa chụp" className={styles.shot} />
        )}

        {showPanel ? (
          <div className={styles.panel} role="alert">
            {failed ? <CameraOff size={32} aria-hidden /> : <AlertCircle size={32} aria-hidden />}
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div
              ref={frameRef}
              className={clsx(styles.frame, (ready || phase === "done") && styles.frameDone)}
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
              disabled={camera !== "live" || !ready}
              onClick={() => void capture()}
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
