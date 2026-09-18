"use client";

import * as Popover from "@radix-ui/react-popover";
import {
  Children,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { SlidersHorizontal } from "lucide-react";
import { FilterField, type FilterFieldProps } from "./FilterField";
import { Button } from "./Button";
import buttonStyles from "./Button.module.css";
import styles from "./FilterButton.module.css";

type Props = {
  /** Số bộ lọc đang bật. 0 thì không hiện chấm đếm. */
  activeCount: number;
  onClear: () => void;
  children: ReactNode;
};

const isFilterField = (node: ReactNode): node is ReactElement<FilterFieldProps> => {
  if (!isValidElement(node)) return false;
  if (node.type === FilterField) return true;
  // Turbopack đôi khi đưa `FilterField` thành hai hàm khác identity — bám
  // `displayName` để cột trái không rơi hết vào mục "Khác".
  return (
    typeof node.type === "function" &&
    "displayName" in node.type &&
    node.type.displayName === "FilterField"
  );
};

/**
 * Nút mở bảng bộ lọc — hai cột: mục bên trái, giá trị bên phải.
 *
 * Gom bộ lọc vào một nút thay vì xếp hết ra thanh trên. Cột trái để nhảy mục
 * mà không phải cuộn một cột dài (đủ phòng, trạng thái, nhân viên…). Cột phải
 * chỉ hiện đúng mục đang chọn.
 *
 * Đang lọc thì nút chỉ đổi sang sắc cam, KHÔNG đeo thêm huy hiệu số: dòng chip
 * bên ngoài đã nói rõ đang lọc gì.
 */
export function FilterButton({ activeCount, onClear, children }: Props) {
  const paneId = useId();
  const nodes = Children.toArray(children);
  const fields = nodes.filter(isFilterField);
  const leftovers = nodes.filter((node) => isValidElement(node) && !isFilterField(node));
  const items: FilterFieldProps[] =
    leftovers.length > 0
      ? [...fields.map((field) => field.props), { id: "__rest", label: "Khác", children: leftovers }]
      : fields.map((field) => field.props);

  const [picked, setPicked] = useState<string | null>(null);
  const selected = items.find((item) => item.id === picked) ?? items[0];
  const split = items.length > 1;

  return (
    <Popover.Root modal={false}>
      <Popover.Trigger asChild>
        <Button
          variant="secondary"
          aria-label="Bộ lọc"
          className={activeCount > 0 ? styles.on : undefined}
        >
          <SlidersHorizontal size={16} aria-hidden />
          <span className={buttonStyles.label}>Bộ lọc</span>
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className={split ? styles.panelWide : styles.panel}
          align="end"
          sideOffset={8}
          collisionPadding={16}
        >
          <div className={split ? styles.split : styles.single}>
            {split && (
              <nav className={styles.nav} aria-label="Mục lọc">
                {items.map((item) => {
                  const current = item.id === selected?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={current ? `${styles.navBtn} ${styles.navBtnOn}` : styles.navBtn}
                      aria-current={current ? "true" : undefined}
                      aria-controls={paneId}
                      onClick={() => setPicked(item.id)}
                    >
                      <span className={styles.navLabel}>{item.label}</span>
                      {(item.count ?? 0) > 0 && (
                        <span className={styles.count} aria-label={`${item.count} đang chọn`}>
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}

            <div id={paneId} className={styles.pane} role="region" aria-label={selected?.label}>
              {selected?.children}
            </div>
          </div>

          <footer className={styles.foot}>
            <button
              type="button"
              className={styles.clear}
              onClick={onClear}
              disabled={activeCount === 0}
            >
              Bỏ hết bộ lọc
            </button>
            <Popover.Close asChild>
              <Button>Xong</Button>
            </Popover.Close>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
