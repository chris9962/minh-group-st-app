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
 * Mã phòng được quy đổi quà (thể lệ 2026-08 lưu ý 2).
 *
 * Viết cứng ở đây là CỐ Ý: đây là màn thử luật, và một ô chọn phòng đầy đủ thì
 * người dùng phải tự biết phòng nào có luật riêng mới thử được. Ô tick nói
 * thẳng ra. Kỳ nào bỏ luật Phòng Y thì bỏ luôn ô này.
 */
const PHONG_Y = "PHONG-Y";

/**
 * P-81 · Nút thử — chỉ tính toán, không ghi gì (spec §5.3). Không tạo khách,
 * không tạo đơn, không trừ mã. Bấm bao nhiêu lần cũng được.
 *
 * Ô nhập khai TỪNG TÀI KHOẢN chứ không khai "tổng số app đã cài" như bản cũ:
 * luật từ kỳ 2026-08 xét tổ hợp hạng ngân hàng, và chỉ `VPa` với `MSBa` mới đòi
 * cài app. Gộp thành một con số thì không diễn tả được ca "mở VPa nhưng chưa
 * cài" — đúng ca hay gặp nhất ngoài hiện trường.
 */
export function GiftSimulator() {
  const [opened, setOpened] = useState<string[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [channel, setChannel] = useState("");
  const [phongY, setPhongY] = useState(false);

  const { data: allBanks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = allBanks.filter((b) => b.active);
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  const run = useMutation({
    mutationFn: () =>
      simulateGift({
        accounts: opened.map((bankCode) => ({ bankCode, appInstalled: apps.includes(bankCode) })),
        channelCodes: channel ? [channel] : [],
        departmentCode: phongY ? PHONG_Y : null,
      }),
    onError: (e) => toast.fail(errorMessage(e, "Chưa chạy thử được.")),
  });

  const toggleOpened = (bank: string) =>
    setOpened((prev) => (prev.includes(bank) ? prev.filter((b) => b !== bank) : [...prev, bank]));

  const toggleApp = (bank: string) =>
    setApps((prev) => (prev.includes(bank) ? prev.filter((b) => b !== bank) : [...prev, bank]));

  return (
    <SectionCard title="Nút thử" icon={<FlaskConical size={17} />}>
      <p className={styles.intro}>
        Nhập giả định một khách để xem quà và điểm KPI tính ra sao — không tạo
        khách, không tạo đơn, không trừ mã.
      </p>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Khách đã mở tài khoản ở</legend>
        {/*
          MỖI NGÂN HÀNG MỘT THẺ CHỌN ĐƯỢC, "đã cài app" là dòng CON bên trong.

          Hai bản trước đều bày ô tích trần: bản đầu dồn hết vào một dòng chảy
          tràn, bản sau kẻ vạch nối. Cả hai đọc được nhưng không ai nhìn ra
          ngay "khách này mở mấy ngân hàng" — phải đếm dấu tích. Thẻ được chọn
          đổi cả viền lẫn nền nên đếm bằng mắt là xong.

          Ô "đã cài app" là thuộc tính của ngân hàng, không phải lựa chọn song
          song, nên nó nằm TRONG thẻ và chỉ hiện khi thẻ được chọn.
        */}
        <ul className={styles.banks}>
          {activeBanks.map((bank) => {
            const picked = opened.includes(bank.code);
            return (
              <li
                key={bank.id}
                className={[styles.bank, picked && styles.bankOn].filter(Boolean).join(" ")}
              >
                <Checkbox
                  block
                  label={bank.code}
                  checked={picked}
                  onCheckedChange={() => toggleOpened(bank.code)}
                />
                {picked && (
                  <div className={styles.bankChild}>
                    <Checkbox
                      /* Trình đọc màn hình nghe mười ba lần "đã cài app" thì
                         không biết ô nào của ngân hàng nào — mã đi kèm, chỉ ẩn
                         khỏi mắt. */
                      label={
                        <>
                          <span className="sr-only">{bank.code} </span>
                          đã cài app
                        </>
                      }
                      checked={apps.includes(bank.code)}
                      onCheckedChange={() => toggleApp(bank.code)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className={styles.row}>
        <Checkbox label="Khách của Phòng Y" checked={phongY} onCheckedChange={setPhongY} />
        <Select
          label="Kênh"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "", label: "— Không thuộc kênh nào —" },
            ...channels.map((c) => ({ value: c.code, label: c.name })),
          ]}
        />
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          Thử
        </Button>
      </div>

      {run.data && (
        <dl className={styles.result}>
          <div>
            <dt>Trường hợp</dt>
            <dd>
              {run.data.caseCode ? (
                <span className={styles.caseTag}>{run.data.caseCode}</span>
              ) : (
                <span className="text-muted">Chưa đủ điều kiện</span>
              )}
              {run.data.insuranceYears > 0 && (
                <span className={styles.detail}>{run.data.insuranceYears} năm bảo hiểm</span>
              )}
            </dd>
          </div>
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
                      <li key={`${item.code}-${i}`}>
                        {item.name}
                        {/* Màn thử của quản trị — đây đúng là chỗ phải thấy món
                            nào đang tắt, vì họ là người bấm cái công tắc đó. */}
                        {item.status !== "ok" && (
                          <strong>
                            {item.status === "discontinued"
                              ? " (đã ngưng cấp)"
                              : " (không còn trong danh mục)"}
                          </strong>
                        )}
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
          {run.data.explain.length > 0 && (
            <div>
              <dt>Vì sao</dt>
              <dd>
                <ol className={styles.basket}>
                  {run.data.explain.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              </dd>
            </div>
          )}
        </dl>
      )}
    </SectionCard>
  );
}
