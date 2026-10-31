"use client";

import * as Popover from "@radix-ui/react-popover";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import type { ActionMenuItem } from "./ActionMenu";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import styles from "./ActionMenu.module.css";

/** Cùng mốc `$bp-mobile` ở `styles/_breakpoints.scss`. */
const MOBILE = "(max-width: 900px)";

/**
 * Nút ba chấm trên thanh trên cùng gom các thao tác phụ (chốt 2026-10-31).
 * Máy tính mở danh sách thả xuống; điện thoại mở form trượt từ đáy, cùng kiểu
 * nút "Tạo mới" ở thanh điều hướng đáy.
 */
export function MoreActionsMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const pick = (item: ActionMenuItem) => {
    setPopoverOpen(false);
    setSheetOpen(false);
    item.onSelect();
  };

  return (
    <>
      <Popover.Root
        open={popoverOpen}
        onOpenChange={(next) => {
          if (next && window.matchMedia(MOBILE).matches) setSheetOpen(true);
          else setPopoverOpen(next);
        }}
      >
        <Popover.Trigger asChild>
          <Button variant="secondary" icon aria-label={label} tooltip={label}>
            <MoreHorizontal size={16} aria-hidden />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className={styles.panel} align="end" sideOffset={6}>
            {items.map((item) => (
              <button key={item.label} type="button" className={styles.item} onClick={() => pick(item)}>
                {item.icon}
                {item.label}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Dialog open={sheetOpen} onClose={() => setSheetOpen(false)} title={label} placement="sheet">
        <div className={styles.sheetList}>
          {items.map((item) => (
            <button key={item.label} type="button" className={styles.item} onClick={() => pick(item)}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </Dialog>
    </>
  );
}
