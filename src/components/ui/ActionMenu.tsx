"use client";

import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { Button } from "./Button";
import buttonStyles from "./Button.module.css";
import styles from "./ActionMenu.module.css";

export type ActionMenuItem = { label: string; icon: React.ReactNode; onSelect: () => void };

/** Một nút trên thanh trên cùng mở danh sách thao tác cùng nhóm, thay cho một dãy nút rời. */
export function ActionMenu({
  label,
  icon,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  items: ActionMenuItem[];
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button aria-label={label}>
          {icon}
          <span className={buttonStyles.label}>{label}</span>
          <ChevronDown size={14} aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.panel} align="end" sideOffset={6}>
          {items.map((item) => (
            <Popover.Close asChild key={item.label}>
              <button type="button" className={styles.item} onClick={item.onSelect}>
                {item.icon}
                {item.label}
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
