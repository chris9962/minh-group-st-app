import styles from "./RowActions.module.scss";

/**
 * Cụm nút thao tác của một dòng bảng — sửa, xoá, và những nút cùng loại.
 *
 * Tách ra vì khối CSS này đã bị chép nguyên văn sang hai trang (Ngân hàng và
 * Dịch vụ) rồi biến thể ở trang thứ ba. AGENTS.md §2: thấy mình sắp chép CSS
 * từ trang này sang trang khác thì dừng lại, tách component.
 */
export function RowActions({ children }: { children: React.ReactNode }) {
  return <div className={styles.wrap}>{children}</div>;
}
