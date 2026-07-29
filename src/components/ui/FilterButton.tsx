"use client";

import * as Popover from "@radix-ui/react-popover";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "./Button";
import styles from "./FilterButton.module.css";

type Props = {
  /** Số bộ lọc đang bật. 0 thì không hiện chấm đếm. */
  activeCount: number;
  onClear: () => void;
  children: React.ReactNode;
};

/**
 * Nút mở bảng bộ lọc.
 *
 * Gom bộ lọc vào một nút thay vì xếp hết ra thanh trên: thanh trên đã có ô tìm
 * kiếm, phạm vi, bộ chọn kỳ và nút thêm — mỗi bộ lọc mới lại đẩy nó xuống một
 * hàng nữa. Đổi lại, bộ lọc bị che thì người dùng không biết mình đang lọc, nên
 * BẮT BUỘC có số đếm ở nút và dòng chip bên ngoài liệt kê bộ lọc đang bật.
 */
export function FilterButton({ activeCount, onClear, children }: Props) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" className={styles.trigger}>
          <SlidersHorizontal size={15} />
          Bộ lọc
          {activeCount > 0 && <span className={styles.count}>{activeCount}</span>}
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className={styles.panel}
          align="end"
          sideOffset={8}
          collisionPadding={16}
        >
          <div className={styles.body}>{children}</div>

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
