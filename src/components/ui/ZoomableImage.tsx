"use client";

import { useRef, useState } from "react";
import { clsx } from "clsx";
import styles from "./ZoomableImage.module.css";

type Props = {
  src: string;
  alt: string;
  /** Báo khi ảnh chuyển giữa cỡ gốc và đang phóng to. */
  onZoomedChange?: (zoomed: boolean) => void;
};

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };

const RESET: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;

const clampAbs = (value: number, limit: number) => Math.min(Math.max(value, -limit), limit);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Ảnh phóng to được bằng hai ngón, chạm hai lần hoặc lăn chuột.
 *
 * Tự xử lý cử chỉ thay vì để trình duyệt zoom cả trang: viewport khoá
 * `maximum-scale=1` (chốt 2026-10-23), nên Android không phóng to trang được
 * nữa. Nơi gọi đổi ảnh thì gắn `key` theo `src` để ảnh mới về cỡ gốc.
 */
export function ZoomableImage({ src, alt, onZoomedChange }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; mid: Point; view: View } | null>(null);
  const down = useRef<Point | null>(null);
  const moved = useRef(false);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const [view, setView] = useState<View>(RESET);

  /**
   * Kẹp ảnh trong khung theo cỡ ảnh THẬT đang hiện, không theo hộp `img`:
   * `object-fit: contain` chừa dải trống hai bên, kẹp theo hộp là kéo được ảnh
   * ra khỏi tầm nhìn.
   */
  const commit = (next: View) => {
    const el = ref.current;
    if (!el) return;
    const scale = Math.min(Math.max(next.scale, 1), MAX_SCALE);
    const fit = Math.min(el.clientWidth / (el.naturalWidth || 1), el.clientHeight / (el.naturalHeight || 1));
    const maxX = Math.max(0, (el.naturalWidth * fit * scale - el.clientWidth) / 2);
    const maxY = Math.max(0, (el.naturalHeight * fit * scale - el.clientHeight) / 2);
    const clamped = scale === 1 ? RESET : { scale, x: clampAbs(next.x, maxX), y: clampAbs(next.y, maxY) };
    if (clamped.scale > 1 !== view.scale > 1) onZoomedChange?.(clamped.scale > 1);
    setView(clamped);
  };

  /** Phóng từ `from` sang `scale`, giữ điểm `focus` trên màn hình đứng yên. */
  const zoomAround = (from: View, scale: number, focus: Point, shift: Point = { x: 0, y: 0 }) => {
    const rect = ref.current!.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2 - view.x, y: rect.top + rect.height / 2 - view.y };
    const k = scale / from.scale;
    commit({
      scale,
      x: (focus.x - center.x) * (1 - k) + k * from.x + shift.x,
      y: (focus.y - center.y) * (1 - k) + k * from.y + shift.y,
    });
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    pinch.current = { dist: distance(a, b), mid: midpoint(a, b), view };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      down.current = { x: e.clientX, y: e.clientY };
      moved.current = false;
    }
    if (pointers.current.size === 2) {
      moved.current = true;
      startPinch();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const point = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, point);
    if (down.current && distance(point, down.current) > TAP_SLOP_PX) moved.current = true;

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = midpoint(a, b);
      const start = pinch.current;
      const scale = Math.min(Math.max((start.view.scale * distance(a, b)) / start.dist, 1), MAX_SCALE);
      zoomAround(start.view, scale, start.mid, { x: mid.x - start.mid.x, y: mid.y - start.mid.y });
      return;
    }
    if (view.scale > 1) commit({ ...view, x: view.x + point.x - prev.x, y: view.y + point.y - prev.y });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 1) pinch.current = null;
    if (pointers.current.size > 0 || moved.current || e.type === "pointercancel") return;

    const point = { x: e.clientX, y: e.clientY };
    const tap = lastTap.current;
    if (tap && e.timeStamp - tap.at < DOUBLE_TAP_MS && distance(point, tap.point) < TAP_SLOP_PX * 3) {
      lastTap.current = null;
      if (view.scale > 1) commit(RESET);
      else zoomAround(view, DOUBLE_TAP_SCALE, point);
      return;
    }
    lastTap.current = { at: e.timeStamp, point };
  };

  const onWheel = (e: React.WheelEvent<HTMLImageElement>) => {
    zoomAround(view, view.scale * Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
  };

  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      draggable={false}
      className={clsx(styles.image, view.scale > 1 && styles.zoomed)}
      style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    />
  );
}
