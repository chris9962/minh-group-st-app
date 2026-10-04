"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ReceiptText } from "lucide-react";
import type { PersonDetail } from "@/lib/api/person";
import { formatVnd } from "@/lib/format";
import { FIXED_SALARY_ITEM } from "@/rules/salary/labels";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import styles from "./SalaryBreakdownButton.module.css";

type Props = {
  amount: number;
  breakdown: PersonDetail["salaryBreakdown"];
  /**
   * Chỉ icon kèm tooltip, cho ô bảng không đủ chỗ cho chữ. Truyền tên người:
   * giữa nhiều dòng giống nhau, nhãn không có tên không nói đang mở lương của ai.
   */
  iconOnly?: { personName: string };
};

const monthText = (month: string) => {
  const [y, m] = month.split("-");
  return `tháng ${Number(m)}/${y}`;
};

/** Mở phép tính lương đang chạy; chỉ đọc, không thay đổi dữ liệu hay chốt lương. */
export function SalaryBreakdownButton({ amount, breakdown, iconOnly }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const show = (e: React.MouseEvent<HTMLButtonElement>) => {
    trigger.current = e.currentTarget;
    setOpen(true);
  };
  // Hộp thoại bị gỡ khỏi DOM lúc đóng nên trình duyệt không tự trả tiêu điểm về
  // nút đã mở nó; người dùng bàn phím mất chỗ đang đứng trong bảng.
  const hide = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };

  return (
    <>
      {iconOnly ? (
        <Button
          variant="secondary"
          icon
          tooltip="Diễn giải lương"
          aria-label={`Diễn giải lương của ${iconOnly.personName}`}
          onClick={show}
        >
          <ReceiptText size={16} aria-hidden />
        </Button>
      ) : (
        <Button variant="secondary" onClick={show}>
          <ReceiptText size={15} aria-hidden />
          Diễn giải
        </Button>
      )}

      {/* Đưa hộp thoại ra `body`: `<dialog>` nằm tại chỗ thì thừa hưởng kiểu chữ
          của nơi đặt nút. Trong ô bảng đó là `white-space: nowrap` và
          `text-align: right`, nên cùng một hộp thoại mà mỗi màn một dáng. */}
      {open &&
        createPortal(
          <Dialog
            open
            onClose={hide}
            title={`Diễn giải lương ${monthText(breakdown.month)}`}
            footer={
              <Button variant="secondary" onClick={hide}>
                Đóng
              </Button>
            }
          >
            {breakdown.items.length > 0 ? (
              <>
                {breakdown.revenue && (
                  <table className={styles.revenue}>
                    <caption className="sr-only">Tiền thu BHYT/BHXH ra điểm KPI</caption>
                    <thead>
                      <tr>
                        <th scope="col">Nhóm</th>
                        <th scope="col">Tiền thu</th>
                        <th scope="col">Mức 1 điểm</th>
                        <th scope="col">Điểm</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {breakdown.revenue.lines.map((line) => (
                        <tr key={line.label}>
                          <th scope="row">{line.label}</th>
                          <td>{line.collected}</td>
                          <td>{line.perPoint}</td>
                          <td>{line.points}</td>
                        </tr>
                      ))}
                      {breakdown.revenue.other && (
                        <tr>
                          <th scope="row" colSpan={3}>
                            Ngân hàng, dịch vụ, điểm cộng
                          </th>
                          <td>{breakdown.revenue.other}</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="tabular-nums">
                      <tr>
                        <th scope="row" colSpan={3}>
                          Điểm KPI
                        </th>
                        <td>{breakdown.revenue.total}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
                {breakdown.facts.length > 0 && (
                  <dl className={styles.facts}>
                    {breakdown.facts.map((fact) => (
                      <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd className="tabular-nums">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className={styles.list}>
                  {breakdown.items.map((item, index) => (
                    <div className={styles.item} key={`${item.label}-${index}`}>
                      <strong className={styles.label}>{item.label}</strong>
                      <span className={styles.formula}>{item.formula}</span>
                      <span className={`${styles.amount} tabular-nums`}>
                        {formatVnd(item.amount)}
                      </span>
                    </div>
                  ))}
                  <div className={styles.total}>
                    <strong>Tổng tạm tính</strong>
                    <strong className="tabular-nums">
                      {formatVnd(amount)}
                    </strong>
                  </div>
                </div>
                {/* TODO(lương CĐS, file mẫu CASA của Yên): gỡ phần CASA khi lương tính CASA. Lương cứng không có CASA. */}
                {!breakdown.items.some((item) => item.label === FIXED_SALARY_ITEM) && (
                  <p className={styles.note}>
                    {/* Khoản hỗ trợ của An Sinh giảm dần mỗi tháng, kế toán tính ngoài app (spec BHYT/BHXH mục 0). */}
                    {breakdown.revenue ? "Chưa gồm CASA và tiền hỗ trợ 2.000.000đ." : "Chưa gồm CASA."}
                  </p>
                )}
              </>
            ) : (
              <p className={styles.empty}>
                Chức vụ hoặc phòng này chưa có công thức lương CĐS.
              </p>
            )}
          </Dialog>,
          document.body,
        )}
    </>
  );
}
