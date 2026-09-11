import { ScanLine, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag, type StatusTone } from "@/components/ui/StatusTag";
import {
  PHOTO_CHECK_LABEL,
  type PhotoCheck,
  type PhotoCheckKey,
  type PhotoCheckVerdict,
} from "@/lib/api/photoCheck";
import { formatDateTime } from "@/lib/format";
import styles from "./PhotoCheckPanel.module.scss";

const ORDER: PhotoCheckKey[] = ["open", "home", "transfer"];

const VERDICT_TONE: Record<PhotoCheckVerdict, StatusTone> = {
  pass: "ok",
  fail: "warn",
  missing: "neutral",
};

const VERDICT_TEXT: Record<PhotoCheckVerdict, string> = {
  pass: "Đạt",
  fail: "Không đạt",
  missing: "Thiếu ảnh",
};

/**
 * Khối "Xác thực ảnh" trên màn chi tiết tài khoản, cùng một khối ở trang
 * nhân viên và trang đối soát ngân hàng.
 *
 * Chỉ để GỢI Ý. Mỗi dòng in cả giá trị OCR đọc được lẫn giá trị hệ thống để
 * người duyệt tự đối chiếu với ảnh, không bắt họ tin máy.
 *
 * `null` = ngân hàng chưa có bộ nhãn hoặc tài khoản chưa hoàn thành: không vẽ
 * gì, không có dòng "chưa hỗ trợ" (không thêm chữ giải thích vào UI).
 *
 * `onMarkError` có thì khối bày nút "Đánh dấu lỗi" ngay cạnh kết quả khi có
 * dòng không đạt, kèm lý do đọc được để điền sẵn vào ô ghi chú. Người duyệt
 * không phải kéo lên nút ở khối trạng thái phía trên.
 */
export function PhotoCheckPanel({
  check,
  onMarkError,
}: {
  check: PhotoCheck | null;
  onMarkError?: (note: string) => void;
}) {
  if (!check) return null;

  const failing = check.status === "done" ? check.items.filter((i) => i.verdict !== "pass") : [];
  const action =
    onMarkError && failing.length > 0 ? (
      <Button
        variant="danger"
        onClick={() => onMarkError(failing.map((i) => i.note).filter(Boolean).join(" "))}
      >
        <TriangleAlert size={16} aria-hidden />
        Đánh dấu lỗi
      </Button>
    ) : undefined;

  const meta =
    check.status === "pending"
      ? "Đang phân tích"
      : check.status === "failed"
        ? "Xác thực hỏng"
        : formatDateTime(check.checkedAt);

  return (
    <SectionCard title="Xác thực ảnh" icon={<ScanLine size={17} />} meta={meta} action={action}>
      {check.status === "pending" && <p className="text-muted">Đang phân tích ảnh.</p>}
      {check.status === "failed" && <p className={styles.error}>{check.error}</p>}
      {check.status === "done" && (
        <ul className={styles.list}>
          {ORDER.map((key) => {
            const item = check.items.find((i) => i.key === key);
            const verdict = item?.verdict ?? "missing";
            return (
              <li key={key}>
                <span className={styles.verdict}>
                  <StatusTag tone={VERDICT_TONE[verdict]}>{VERDICT_TEXT[verdict]}</StatusTag>
                </span>
                <div className={styles.text}>
                  <span className={styles.label}>{PHOTO_CHECK_LABEL[key]}</span>
                  {item?.found && (
                    <span>
                      Trên ảnh: <b>{item.found}</b>
                    </span>
                  )}
                  {item?.expected && (
                    <span>
                      Hệ thống: <b>{item.expected}</b>
                    </span>
                  )}
                  {item?.note && <span className={styles.note}>{item.note}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
