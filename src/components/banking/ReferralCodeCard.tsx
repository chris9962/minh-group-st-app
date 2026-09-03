"use client";

import { CopyValue } from "@/components/ui/CopyValue";
import { referralBranchLine, type BankAccountDetail } from "@/lib/api/banking";
import styles from "./ReferralCodeCard.module.scss";

/**
 * Khối mã giới thiệu của bước 2 — ba trường đúng bộ mà bước 1 hiện lúc chọn mã,
 * để nhân viên đối chiếu được mình đang mở app bằng đúng mã đã giữ chỗ.
 *
 * Nhãn lấy đúng tên ở P-61: "Tên hiển thị" là tên nhận biết mã, "Mã text" mới là
 * chuỗi gõ sang app ngân hàng. Mã text chép được vì gõ tay là chỗ dễ sai nhất
 * của cả luồng. Mã QR-only không có chuỗi nào để chép nên dòng đó biến mất —
 * đường đi của ca đó là nút QR bên dưới.
 *
 * Đứng riêng thành khối chứ không nằm trong lưới trường của trang: hộp thoại
 * P-21 và trang P-22 phải hiện cùng một khối, mà chép CSS sang hai nơi là hai
 * nơi sớm muộn lệch nhau.
 */
export function ReferralCodeCard({ account }: { account: BankAccountDetail }) {
  const branch = referralBranchLine(account);

  return (
    <div className={styles.card}>
      <span className={styles.label}>Tên hiển thị</span>
      <span>{account.referralCode}</span>

      {account.referralCodeText && (
        <>
          <span className={styles.label}>Mã text</span>
          <CopyValue value={account.referralCodeText} label="mã text" />
        </>
      )}

      {branch && (
        <>
          <span className={styles.label}>CN PGD</span>
          <span>{branch}</span>
        </>
      )}
    </div>
  );
}
