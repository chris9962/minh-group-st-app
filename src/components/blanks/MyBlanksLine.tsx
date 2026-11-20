"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchMyBlanks, hasOwnBlanks, MY_BLANKS_KEY, type OwnBlank } from "@/lib/api/myBlanks";
import { formatCount } from "@/lib/format";
import { MyBlanksDialog } from "./MyBlanksDialog";
import styles from "./MyBlanksLine.module.scss";

const total = (items: OwnBlank[]) => items.reduce((sum, item) => sum + item.remaining, 0);

/** Số phôi, phiếu người này đang giữ, ở màn Tổng quan. Bấm vào để báo số còn lại. */
export function MyBlanksLine() {
  const { data, refetch } = useQuery({ queryKey: MY_BLANKS_KEY, queryFn: fetchMyBlanks });
  const [open, setOpen] = useState(false);
  if (!hasOwnBlanks(data)) return null;

  return (
    <>
      <button
        type="button"
        className={styles.line}
        aria-haspopup="dialog"
        onClick={() => void refetch().then(({ data: fresh }) => setOpen(hasOwnBlanks(fresh)))}
      >
        <span>
          Phôi còn lại <span className={`${styles.count} tabular-nums`}>{formatCount(total(data.insurance))}</span>
        </span>
        <span className={styles.divider} aria-hidden>
          |
        </span>
        <span>
          Phiếu còn lại <span className={`${styles.count} tabular-nums`}>{formatCount(total(data.bank))}</span>
        </span>
      </button>
      {open && <MyBlanksDialog data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
