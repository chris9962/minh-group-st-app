"use client";

import { createPortal } from "react-dom";
import { Dialog } from "@/components/ui/Dialog";
import type { Bank } from "@/lib/api/bankCatalog";
import { formatDate } from "@/lib/format";
import {
  bankTierFor,
  comboPointsAt,
  householdPointsAt,
  openNotesAt,
  TIER_LABEL,
  type ScoringAccount,
  type Tier,
} from "@/rules";
import styles from "./BankComboRulesDialog.module.scss";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Ngày tra luật — ngày tài khoản sẽ mang khi mở. */
  at: string;
  banks: Bank[];
};

const TIERS: Tier[] = ["priority", "other", "restricted"];

/**
 * Điểm CAO NHẤT tra được cho một dạng tổ hợp, thử mọi cách chọn mã trong danh
 * mục theo hạng của ngày `at`. Không viết cứng mã đại diện: LPB là Bank khác
 * ngày 15/9 và Bank hạn chế ngày 16/9, và vài mã có ngoại lệ riêng (MSBa ngoài
 * Combo 1 và 2, VPa cùng VPb là dữ liệu sai) nên một bộ mã cố định tra ra 0 ở
 * dòng lẽ ra có điểm. Danh mục vài chục mã, tổ hợp tối đa 3, duyệt hết là rẻ.
 */
function bestPointsOf(tiers: Tier[], pools: Record<Tier, string[]>, at: string): number {
  let best = 0;
  const walk = (i: number, chosen: string[]) => {
    if (i === tiers.length) {
      best = Math.max(best, comboPointsAt(chosen, at));
      return;
    }
    for (const code of pools[tiers[i]])
      if (!chosen.includes(code)) walk(i + 1, [...chosen, code]);
  };
  walk(0, []);
  return best;
}
const COMBOS: { label: string; tiers: Tier[] }[] = [
  { label: "1 ưu tiên", tiers: ["priority"] },
  { label: "1 khác", tiers: ["other"] },
  { label: "2 ưu tiên", tiers: ["priority", "priority"] },
  { label: "1 ưu tiên + 1 khác", tiers: ["priority", "other"] },
  { label: "2 khác", tiers: ["other", "other"] },
  { label: "3 ưu tiên", tiers: ["priority", "priority", "priority"] },
  { label: "2 ưu tiên + 1 khác", tiers: ["priority", "priority", "other"] },
  { label: "2 ưu tiên + 1 hạn chế", tiers: ["priority", "priority", "restricted"] },
  { label: "1 ưu tiên + 2 khác", tiers: ["priority", "other", "other"] },
  { label: "1 ưu tiên + 1 khác + 1 hạn chế", tiers: ["priority", "other", "restricted"] },
  { label: "3 khác", tiers: ["other", "other", "other"] },
  { label: "2 khác + 1 hạn chế", tiers: ["other", "other", "restricted"] },
];

/**
 * Luật chọn tổ hợp của kỳ đang hiệu lực, chỉ ĐỌC.
 *
 * Mọi thứ tra từ `src/rules` theo ngày: hạng từng ngân hàng, điểm từng tổ hợp,
 * và các câu luật. Không viết cứng mã hay số ở đây, để ngày đổi kỳ hộp thoại
 * tự đúng.
 */
export function BankComboRulesDialog({ open, onClose, at, banks }: Props) {
  const byTier = TIERS.map((tier) => ({
    tier,
    codes: banks.filter((b) => b.active && bankTierFor(b.code, at) === tier).map((b) => b.code),
  }));
  const pools: Record<Tier, string[]> = { priority: [], other: [], restricted: [] };
  for (const { tier, codes } of byTier) pools[tier] = codes;
  // Dòng ra 0 là tổ hợp không có trong bảng của kỳ, bỏ khỏi bảng.
  const rows = COMBOS.map((c) => ({ label: c.label, points: bestPointsOf(c.tiers, pools, at) }))
    .filter((r) => r.points > 0);
  const notes = openNotesAt(at);

  /**
   * Điểm CNKD và HKD tra bằng một khách giả có đúng ngân hàng chủ: HKD chỉ kèm
   * VPa, CNKD kèm bất kỳ ngân hàng nào nên tra bằng VPa là đủ. Dòng ra 0 bỏ.
   */
  const household = (label: string, kind: "CNKD" | "HKD") => {
    const acc: ScoringAccount = {
      customerId: "rules",
      bankCode: "VPa",
      appInstalled: true,
      openedDate: at,
      household: kind,
    };
    return { label, points: householdPointsAt([acc], at) };
  };
  const extras = [household("CNKD, cộng thêm mỗi khách", "CNKD"), household("VPa HKD, cộng thêm mỗi khách", "HKD")]
    .filter((r) => r.points > 0);

  /**
   * Dựng ra `document.body`, không lồng trong hộp thoại đang gọi.
   *
   * Hộp thoại mở tài khoản mở hộp này từ bên trong vùng cuộn của nó. Vùng đó
   * đặt `overscroll-behavior: contain`, và hộp con nằm trong DOM của nó nên
   * lượt cuộn trên hộp con bị vùng cha nuốt: hộp luật dài hơn màn điện thoại
   * mà không cuộn được. Toast cũng đi portal vì lý do tương tự.
   */
  if (typeof document === "undefined") return null;
  return createPortal(
    <Dialog open={open} onClose={onClose} title="Luật chọn ngân hàng">
      <p className={styles.meta}>Áp cho tài khoản mở ngày {formatDate(at)}.</p>

      <h3 className={styles.heading}>Hạng ngân hàng</h3>
      <dl className={styles.tiers}>
        {byTier.map(({ tier, codes }) => (
          <div key={tier} className={styles.tierRow}>
            <dt>{TIER_LABEL[tier]}</dt>
            <dd>{codes.length > 0 ? codes.join(", ") : "không có"}</dd>
          </div>
        ))}
      </dl>

      <h3 className={styles.heading}>Điểm theo tổ hợp</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Tổ hợp</th>
            <th scope="col">Điểm</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="tabular-nums">{r.points.toFixed(1).replace(".", ",")}</td>
            </tr>
          ))}
          {extras.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td className="tabular-nums">+{r.points.toFixed(1).replace(".", ",")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {notes.length > 0 && (
        <>
          <h3 className={styles.heading}>Luật triển khai</h3>
          <ul className={styles.notes}>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </Dialog>,
    document.body,
  );
}
