"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { errorMessage, toast } from "@/lib/toast";
import { fetchBanks } from "@/lib/api/bankCatalog";
import { fetchChannels } from "@/lib/api/channelCatalog";
import { simulateGift } from "@/lib/api/settings";
import { formatVnd } from "@/lib/format";
import styles from "./GiftSimulator.module.scss";

/**
 * P-81 · Nút thử — chỉ tính toán, không ghi gì (spec §5.3). Không tạo khách,
 * không tạo đơn, không trừ mã. Bấm bao nhiêu lần cũng được.
 */
export function GiftSimulator() {
  const [banks, setBanks] = useState<string[]>([]);
  const [cnkd, setCnkd] = useState(false);
  const [channel, setChannel] = useState("");

  const { data: allBanks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = allBanks.filter((b) => b.active);
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  /**
   * TODO(P-81, chờ `src/rules/2026-08.ts`): bấm "Thử" hiện luôn báo lỗi —
   * `/api/settings/gift-rules/simulate` chưa có route. Gỡ cùng lúc với mốc ở
   * `lib/api/settings.ts`.
   */
  const run = useMutation({
    mutationFn: () =>
      simulateGift({ installedBanks: banks, cnkd, channels: channel ? [channel] : [] }),
    onError: (e) =>
      toast.fail(errorMessage(e, "Chưa chạy thử được — kỳ này chưa có file luật quà.")),
  });

  const toggleBank = (bank: string) =>
    setBanks((prev) => (prev.includes(bank) ? prev.filter((b) => b !== bank) : [...prev, bank]));

  return (
    <SectionCard title="Nút thử" icon={<FlaskConical size={17} />}>
      <p className={styles.intro}>
        Nhập giả định một khách để xem quà và điểm KPI tính ra sao — không tạo
        khách, không tạo đơn, không trừ mã.
      </p>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>App đã cài</legend>
        <div className={styles.banks}>
          {activeBanks.map((bank) => (
            <Checkbox
              key={bank.id}
              label={bank.code}
              checked={banks.includes(bank.code)}
              onCheckedChange={() => toggleBank(bank.code)}
            />
          ))}
        </div>
      </fieldset>

      <div className={styles.row}>
        <Checkbox label="Mở CNKD/HKD" checked={cnkd} onCheckedChange={setCnkd} />
        <Select
          label="Kênh"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "", label: "— Không thuộc kênh nào —" },
            ...channels.map((c) => ({ value: c.name, label: c.name })),
          ]}
        />
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          Thử
        </Button>
      </div>

      {run.data && (
        <dl className={styles.result}>
          <div>
            <dt>Tiền mặt</dt>
            <dd>
              <span className="tabular-nums">{formatVnd(run.data.cashTotal)}</span>
              {run.data.cashBreakdown.length > 0 && (
                <span className={styles.detail}>
                  {run.data.cashBreakdown
                    .map((b) => `${formatVnd(b.amount)} (${b.label})`)
                    .join(" + ")}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Rổ quà</dt>
            <dd>
              {run.data.basket.length === 0 ? (
                "Không có món nào"
              ) : (
                <>
                  <span>
                    Khách chọn <strong>đúng 1</strong> trong{" "}
                    <span className="tabular-nums">{run.data.basket.length}</span> món dưới đây
                    (hoặc từ chối, không lấy gì):
                  </span>
                  <ol className={styles.basket}>
                    {run.data.basket.map((item, i) => (
                      <li key={`${item.id}-${i}`}>
                        {item.name}
                        <span className={styles.detail}>{item.source}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Điểm KPI</dt>
            <dd>
              <span className="tabular-nums">{run.data.kpiPoints}</span>
              {run.data.kpiBreakdown.length > 0 && (
                <span className={styles.detail}>
                  {run.data.kpiBreakdown.map((b) => `${b.label} ${b.points}`).join(" + ")}
                </span>
              )}
            </dd>
          </div>
        </dl>
      )}
    </SectionCard>
  );
}
