"use client";

import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { DateField } from "@/components/ui/DateField";
import { SectionCard } from "@/components/ui/SectionCard";
import { Select } from "@/components/ui/Select";
import { errorMessage } from "@/lib/toast";
import { fetchBanks } from "@/lib/api/bankCatalog";
import { MAX_BANK_ACCOUNTS_PER_CUSTOMER, type AccountType } from "@/lib/api/bankAccounts";
import { fetchChannels } from "@/lib/api/channelCatalog";
import { simulateGift, type GiftSimulateInput } from "@/lib/api/settings";
import { formatVnd } from "@/lib/format";
import styles from "./RuleSimulator.module.scss";

/**
 * Ba lựa chọn phòng, không phải một ô tick.
 *
 * Viết cứng ở đây là CỐ Ý: đây là màn thử luật, và một ô chọn phòng đầy đủ thì
 * người dùng phải tự biết phòng nào có luật riêng mới thử được. Danh sách này
 * nói thẳng ra. Kỳ nào bỏ luật Phòng Y thì bỏ luôn dòng đó.
 *
 * ⚠️ Phòng Y và phòng Dự án KHÁC NHAU từ 2026-08-25: cả hai được Mì, BH sức
 * khoẻ, Nón bảo hiểm, nhưng chỉ Phòng Y có thêm Bảng mica (M13). Bản trước để
 * một ô tick nên nhánh Dự án không thử được.
 */
const DEPARTMENTS: { value: string; label: string }[] = [
  { value: "", label: "— Không thuộc phòng có luật riêng —" },
  { value: "PHONG-Y", label: "Phòng Y — quy đổi quà ở TH5, TH6" },
  { value: "PHONG-DU-AN", label: "Phòng Dự án — quy đổi quà ở TH5, TH6" },
];

/**
 * Hai ngân hàng chủ của CNKD/HKD — nhãn giữ đúng chữ của màn P-20.
 *
 * Kỳ 2026-08 chỉ có `VPa`. Kỳ 2026-09 thêm `VPb` cho CNKD, theo lưu ý 3.
 *
 * Ô chọn vẫn hiện cả `CNKD` lẫn `HKD` trên dòng `VPb`, dù `HKD` kèm `VPb` là
 * dữ liệu sai: màn này để THỬ luật, nên nó phải dựng được cả ca sai để người
 * dùng thấy kết quả ra rỗng.
 */
const HOUSEHOLD_HOST_BANKS = ["VPa", "VPb"];
const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  none: "Không",
  CNKD: "CNKD",
  HKD: "HKD",
};

/**
 * P-81 · Nút thử — chỉ tính toán, không ghi gì (spec §5.3). Không tạo khách,
 * không tạo đơn, không trừ mã. Bấm bao nhiêu lần cũng được.
 *
 * Không có nút bấm: chọn tới đâu máy trả kết quả tới đó.
 *
 * Quà và điểm nằm CHUNG một khối kết quả (chốt 2026-09-03). Hai phần đi ra từ
 * cùng một lượt gọi `simulateGift`, nên tách làm hai tab chỉ giấu đi nửa số
 * liệu đã tải về sẵn.
 *
 * Ô nhập khai TỪNG TÀI KHOẢN chứ không khai "tổng số app đã cài" như bản cũ:
 * luật từ kỳ 2026-08 xét tổ hợp hạng ngân hàng, và chỉ `VPa` với `MSBa` mới đòi
 * cài app. Gộp thành một con số thì không diễn tả được ca "mở VPa nhưng chưa
 * cài" — đúng ca hay gặp nhất ngoài hiện trường.
 */
export function RuleSimulator() {
  const [opened, setOpened] = useState<string[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const [channel, setChannel] = useState("");
  const [department, setDepartment] = useState("");
  /** Rỗng nghĩa là để máy chủ dùng ngày làm việc — xem `GiftSimulateInput.at`. */
  const [at, setAt] = useState("");
  /** Một mã cho mỗi ngân hàng chủ — khách tick CNKD trên VPa hay VPb là hai ca khác nhau. */
  const [accountTypes, setAccountTypes] = useState<Record<string, AccountType>>({});

  const { data: allBanks = [] } = useQuery({ queryKey: ["banks"], queryFn: fetchBanks });
  const activeBanks = allBanks.filter((b) => b.active);
  const { data: channels = [] } = useQuery({ queryKey: ["channels"], queryFn: fetchChannels });

  /**
   * Tình huống đang khai, tính THẲNG khi render — không giữ trong state.
   *
   * Nó là giá trị suy ra từ sáu ô nhập, nên `useEffect` để đồng bộ là thừa
   * (AGENTS.md §7). Chính nó cũng là khoá truy vấn: ô nào đổi thì khoá đổi và
   * TanStack Query chạy lại.
   */
  const input: GiftSimulateInput = {
    accounts: opened.map((bankCode) => ({
      bankCode,
      appInstalled: apps.includes(bankCode),
      accountType: accountTypes[bankCode] ?? ("none" as AccountType),
    })),
    channelCodes: channel ? [channel] : [],
    departmentCode: department || null,
    /**
     * Màn thử KHÔNG khai món khách đã nhận — bỏ ô đó 2026-09-03.
     *
     * Từ kỳ 2026-09 món đã nhận không đổi tiền lẫn rổ quà, nên ô ấy chỉ còn
     * nghĩa khi tra ngược ngày của kỳ 2026-08. Giữ lại thì Kế toán phải đoán
     * xem nó có tác dụng gì.
     */
    grantedItem: null,
    at: at || null,
  };

  /**
   * Chọn tới đâu ra kết quả tới đó, không có nút bấm.
   *
   * `placeholderData` giữ kết quả của lần chọn trước trong lúc gọi máy chủ. Bỏ
   * nó thì mỗi lần tick một ô là cả khối kết quả biến mất rồi hiện lại.
   *
   * `enabled` chặn lượt gọi khi khách chưa mở ngân hàng nào: kết quả lúc đó
   * luôn là rổ rỗng, không đáng một lượt đi mạng.
   */
  const run = useQuery({
    queryKey: ["gift-simulate", input],
    queryFn: () => simulateGift(input),
    enabled: opened.length > 0,
    placeholderData: (prev) => prev,
  });

  /**
   * Trần 3 ngân hàng — cùng con số `startBankAccount` chặn ở máy chủ và unique
   * index `bank_accounts_customer_bank` chặn ở database (chốt 2026-08-25).
   *
   * Màn thử để đo LUẬT, nên nó chỉ được dựng ra những khách hệ thống dựng được.
   * Bản trước tick bao nhiêu ngân hàng cũng xong, và khách 5 ngân hàng ra một
   * kết quả không ai gặp ngoài đời.
   */
  const full = opened.length >= MAX_BANK_ACCOUNTS_PER_CUSTOMER;

  const toggleOpened = (bank: string) =>
    setOpened((prev) => (prev.includes(bank) ? prev.filter((b) => b !== bank) : [...prev, bank]));

  const toggleApp = (bank: string) =>
    setApps((prev) => (prev.includes(bank) ? prev.filter((b) => b !== bank) : [...prev, bank]));

  /**
   * Hai phần cấu thành tổng điểm, gộp thành MỘT dòng phụ dưới con số tổng.
   *
   * Bản trước dựng ba dòng nhãn/giá trị ngang hàng nhau, nên người đọc phải tự
   * cộng để biết dòng nào ra dòng nào.
   */
  const pointsDetail = run.data
    ? [
        `Tổ hợp ${run.data.kpiPoints}${
          run.data.kpiBreakdown.length > 0
            ? ` (${run.data.kpiBreakdown.map((b) => b.label).join(" + ")})`
            : ""
        }`,
        `CNKD/HKD ${run.data.householdPoints}${
          run.data.householdNote ? ` (${run.data.householdNote})` : ""
        }`,
      ].join(" + ")
    : "";

  /** Nguồn chung của cả rổ; `''` = mỗi món một nguồn, lúc đó in ở từng dòng. */
  const basketSources = new Set(run.data?.basket.map((item) => item.source) ?? []);
  const sharedSource = basketSources.size === 1 ? [...basketSources][0] : "";

  return (
    <SectionCard
      title="Thử quy tắc quà & điểm"
      icon={<FlaskConical size={17} />}
    >
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>
          Khách đã mở tài khoản ở{" "}
          <span className={styles.count}>
            {opened.length}/{MAX_BANK_ACCOUNTS_PER_CUSTOMER}
          </span>
        </legend>
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
                className={clsx(
                  styles.bank,
                  picked && styles.bankOn,
                  !picked && full && styles.bankOff,
                )}
              >
                <Checkbox
                  block
                  label={bank.code}
                  checked={picked}
                  // Bỏ tick thì luôn được, kể cả khi đã đủ trần — nếu không thì
                  // chọn nhầm ngân hàng thứ ba là phải tải lại trang.
                  disabled={!picked && full}
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
                    {/* HKD kèm VPa thì rổ có thêm Loa và Bảng mica, còn CNKD
                        kèm VPb thì mở bậc TH7 — không có ô này thì màn thử
                        không dựng được hai ca đó. */}
                    {HOUSEHOLD_HOST_BANKS.includes(bank.code) && (
                      <div className={styles.bankType}>
                        <Select
                          block
                          label="Mở tài khoản CNKD / HKD"
                          value={accountTypes[bank.code] ?? "none"}
                          onChange={(v) =>
                            setAccountTypes((prev) => ({ ...prev, [bank.code]: v as AccountType }))
                          }
                          options={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({
                            value,
                            label,
                          }))}
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className={styles.row}>
        <Select
          label="Phòng của người phụ trách"
          value={department}
          onChange={setDepartment}
          options={DEPARTMENTS}
        />
        <Select
          label="Kênh"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "", label: "— Không thuộc kênh nào —" },
            ...channels.map((c) => ({ value: c.code, label: c.name })),
          ]}
        />
      </div>

      <div className={styles.row}>
        {/* Luật tra theo NGÀY: kỳ nào cũng có file riêng và một ngày chỉ thuộc
            một kỳ. Không có ô này thì màn chỉ thử được kỳ đang hiệu lực. */}
        <DateField
          label="Ngày tra luật"
          value={at}
          onChange={setAt}
          hint="Bỏ trống là ngày làm việc"
        />
      </div>

      {run.error && (
        <p className={styles.failed}>{errorMessage(run.error, "Chưa chạy thử được.")}</p>
      )}

      {/* Bỏ tick hết ngân hàng thì xoá luôn kết quả. `placeholderData` giữ số
          của lần chọn trước, nên không có dòng này là màn hiện kết quả của một
          tình huống người dùng vừa xoá. */}
      {opened.length > 0 && run.data && (
        <div className={styles.result}>
          {/* Ba con số kết luận đứng thành hàng riêng: người dùng mở màn này để
              biết khách rơi vào bậc nào, được bao nhiêu tiền và bao nhiêu điểm.
              Bản trước xếp chúng lẫn vào bảy dòng nhãn/giá trị nên phải đọc hết
              mới nhặt ra ba số đó. */}
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt>Trường hợp</dt>
              <dd>
                {run.data.caseCode ? (
                  <span className={styles.caseTag}>{run.data.caseCode}</span>
                ) : (
                  <span className="text-muted">Chưa đủ điều kiện</span>
                )}
                {run.data.insuranceYears > 0 && (
                  <span className={styles.statNote}>
                    {run.data.caseCode === "TH5"
                      ? "Chọn gói bảo hiểm 1 hoặc 2 năm"
                      : `${run.data.insuranceYears} năm bảo hiểm`}
                  </span>
                )}
              </dd>
            </div>

            <div className={styles.stat}>
              <dt>Tiền mặt</dt>
              <dd>
                <strong className="tabular-nums">{formatVnd(run.data.cashTotal)}</strong>
                {run.data.cashBreakdown.length > 0 && (
                  <span className={styles.statNote}>
                    {run.data.cashBreakdown
                      .map((b) => `${formatVnd(b.amount)} (${b.label})`)
                      .join(" + ")}
                  </span>
                )}
              </dd>
            </div>

            {/* Điểm CNKD/HKD nằm NGOÀI điểm tổ hợp và không đổi bậc quà, nhưng
                cộng vào tổng — nên nó là dòng phụ của tổng, không phải một ô số
                liệu ngang hàng. */}
            <div className={styles.stat}>
              <dt>Tổng điểm</dt>
              <dd>
                <strong className="tabular-nums">{run.data.totalPoints}</strong>
                <span className={styles.statNote}>{pointsDetail}</span>
                {run.data.pointsNote && (
                  <span className={styles.statNote}>{run.data.pointsNote}</span>
                )}
              </dd>
            </div>
          </dl>

          <section className={styles.block}>
            <h3 className={styles.blockTitle}>Danh sách quà</h3>
            {run.data.basket.length === 0 ? (
              <p className={styles.blockText}>Không có món nào</p>
            ) : (
              <>
                <p className={styles.blockText}>
                  Khách chọn <strong>đúng 1</strong> trong{" "}
                  <span className="tabular-nums">{run.data.basket.length}</span> món dưới đây, hoặc
                  từ chối không lấy gì.
                  {/* Cả rổ cùng một nguồn là ca thường gặp — in nguồn ở từng
                      dòng thì cùng một câu lặp lại bốn lần. */}
                  {sharedSource && <span className={styles.statNote}>{sharedSource}</span>}
                </p>
                <ol className={styles.basket}>
                  {run.data.basket.map((item, i) => (
                    <li key={`${item.code}-${i}`}>
                      <span>
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
                      </span>
                      {!sharedSource && <span className={styles.detail}>{item.source}</span>}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {/* Khoản ngoài hệ thống, không phải món chọn được. */}
            {run.data.giftNote && <p className={styles.blockText}>{run.data.giftNote}</p>}
          </section>

          {run.data.explain.length > 0 && (
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Vì sao</h3>
              <ol className={styles.reasons}>
                {run.data.explain.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </SectionCard>
  );
}
