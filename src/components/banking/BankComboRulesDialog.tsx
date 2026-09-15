"use client";

import { Dialog } from "@/components/ui/Dialog";
import type { Bank } from "@/lib/api/bankCatalog";
import { formatDate } from "@/lib/format";
import { bankTierFor, comboPointsAt, openNotesAt, TIER_LABEL, type Tier } from "@/rules";
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
 * Mã đại diện để tra bảng điểm: một mã mỗi hạng, chọn mã không có ngoại lệ
 * riêng (MSBa ngoài Combo 1 và 2, VPb có ca CNKD). Dòng nào ra 0 là tổ hợp
 * không có trong bảng của kỳ, giao diện bỏ dòng đó.
 */
const SAMPLE: Record<Tier, string[]> = {
  priority: ["MB", "VPa"],
  other: ["TPB", "MSBb", "TCB"],
  restricted: ["LPB"],
};
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
  const rows = COMBOS.map((c) => {
    const used: Record<Tier, number> = { priority: 0, other: 0, restricted: 0 };
    const codes = c.tiers.map((t) => SAMPLE[t][used[t]++]);
    return { label: c.label, points: comboPointsAt(codes, at) };
  }).filter((r) => r.points > 0);
  const notes = openNotesAt(at);

  return (
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
    </Dialog>
  );
}
