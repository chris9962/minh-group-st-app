import styles from "./CharCount.module.css";

type Props = {
  value: string | undefined;
  /** Số ký tự cần đủ. Ô nhập tự đặt `maxLength` cùng số này để chặn gõ quá. */
  max: number;
};

/**
 * Bộ đếm ký tự `5/12`, dán vào `labelAppend` của `TextField`.
 *
 * Đứng riêng chứ không nằm trong `TextField`: nơi gọi đã có giá trị của ô trong
 * tay (`watch()` của react-hook-form), nên nó truyền xuống là xong. Nhồi vào ô
 * nhập thì ô phải tự dò giá trị của chính mình — mà ô đi qua `register()` là ô
 * KHÔNG kiểm soát, dò được thì cũng bằng state cộng effect đọc DOM.
 *
 * `aria-hidden`: con số đổi theo từng phím gõ, đọc lên là ồn. Người dùng trình
 * đọc màn hình nghe nội dung ô khi di chuyển con trỏ, và `hint` của ô nói rõ
 * yêu cầu độ dài.
 */
export function CharCount({ value, max }: Props) {
  const typed = value?.length ?? 0;
  return (
    <span className={typed === max ? styles.done : styles.count} aria-hidden>
      {typed}/{max}
    </span>
  );
}
