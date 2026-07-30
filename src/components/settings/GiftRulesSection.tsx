"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Gift, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { StatusTag } from "@/components/ui/StatusTag";
import {
  APP_COMPARATOR_LABEL,
  fetchGiftItems,
  fetchGiftRules,
  fetchInsurancePackages,
  GIFT_GROUP_LABEL,
  GIFT_MODE_LABEL,
  moveGiftRule,
  setGiftRuleActive,
  type GiftRule,
} from "@/lib/api/settings";
import { formatDate, formatVnd } from "@/lib/format";
import { GiftRuleFormDialog } from "./GiftRuleFormDialog";
import { GiftSimulator } from "./GiftSimulator";
import styles from "./GiftRulesSection.module.scss";

/** Tên món quà từ id — bảng quy tắc chỉ lưu id, tra sang tên để đọc được. */
function giftNamesOf(
  ids: string[],
  giftItems: { id: string; name: string }[],
  packages: { id: string; name: string }[],
): string[] {
  return ids.map(
    (id) =>
      giftItems.find((g) => g.id === id)?.name ?? packages.find((p) => p.id === id)?.name ?? id,
  );
}

/**
 * "hoặc" in đậm giữa các món — khách lấy ĐÚNG 1 món trong rổ (spec §5.2 bước
 * 3), chữ thường xen giữa dễ đọc nhầm thành liệt kê "cho tất cả các món".
 */
function GiftNames({ names }: { names: string[] }) {
  return (
    <>
      {names.map((name, i) => (
        <span key={`${name}-${i}`}>
          {i > 0 && <strong> hoặc </strong>}
          {name}
        </span>
      ))}
    </>
  );
}

/** P-81 · Quy tắc quà — bảng có thứ tự ưu tiên + nút thử. */
export function GiftRulesSection() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GiftRule | null>(null);

  const { data: rules, isPending, isError } = useQuery({
    queryKey: ["gift-rules"],
    queryFn: fetchGiftRules,
  });
  const { data: giftItems = [] } = useQuery({
    queryKey: ["gift-items"],
    queryFn: fetchGiftItems,
  });
  const { data: packages = [] } = useQuery({
    queryKey: ["insurance-packages"],
    queryFn: fetchInsurancePackages,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["gift-rules"] });

  const move = useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: "up" | "down" }) =>
      moveGiftRule(id, direction),
    onSuccess: invalidate,
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setGiftRuleActive(id, next),
    onSuccess: invalidate,
  });

  return (
    <>
      <SectionCard
        title="Quy tắc quà"
        icon={<Gift size={17} />}
        meta={rules ? `${rules.length} dòng` : undefined}
      >
        {isPending && <p className="text-muted">Đang tải bảng quy tắc…</p>}
        {isError && <p className="text-muted">Không tải được bảng quy tắc quà.</p>}

        {rules && (
          <div className="table-scroll">
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Quy tắc quà, theo thứ tự ưu tiên</caption>
              <thead>
                <tr>
                  <th scope="col">Thứ tự</th>
                  <th scope="col">Nhóm</th>
                  <th scope="col">Cách chạy</th>
                  <th scope="col">Ngân hàng bắt buộc</th>
                  <th scope="col">Tổng app</th>
                  <th scope="col">Kênh</th>
                  <th scope="col">Quà / món góp</th>
                  <th scope="col">Hiệu lực</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={r.id}>
                    <td className="tabular-nums">{r.order}</td>
                    <td>{GIFT_GROUP_LABEL[r.group]}</td>
                    <td>{GIFT_MODE_LABEL[r.mode]}</td>
                    <td>
                      {r.requiredBank ?? "—"}
                      {r.requiresCnkd && " · mở CNKD/HKD"}
                    </td>
                    <td>
                      {r.appCountComparator === "none"
                        ? "—"
                        : `${APP_COMPARATOR_LABEL[r.appCountComparator]} ${r.appCountValue}`}
                    </td>
                    <td>{r.channel ?? "—"}</td>
                    <td>
                      {r.group === "cash" ? (
                        formatVnd(r.cashAmount ?? 0)
                      ) : (
                        <GiftNames names={giftNamesOf(r.giftItemIds, giftItems, packages)} />
                      )}
                    </td>
                    <td>
                      {formatDate(r.effectiveFrom)} –{" "}
                      {r.effectiveTo ? formatDate(r.effectiveTo) : "—"}
                    </td>
                    <td>
                      <StatusTag ok={r.active}>
                        {r.active ? "Đang áp dụng" : "Đã ngừng"}
                      </StatusTag>
                    </td>
                    <td>
                      <span className={styles.actions}>
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`Lên trên, dòng thứ tự ${r.order}`}
                          disabled={i === 0 || move.isPending}
                          onClick={() => move.mutate({ id: r.id, direction: "up" })}
                        >
                          <ChevronUp size={16} aria-hidden />
                        </Button>
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`Xuống dưới, dòng thứ tự ${r.order}`}
                          disabled={i === rules.length - 1 || move.isPending}
                          onClick={() => move.mutate({ id: r.id, direction: "down" })}
                        >
                          <ChevronDown size={16} aria-hidden />
                        </Button>
                        <Button
                          variant="secondary"
                          icon
                          aria-label={`Sửa dòng thứ tự ${r.order}`}
                          onClick={() => setEditing(r)}
                        >
                          <Pencil size={16} aria-hidden />
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={toggleActive.isPending}
                          onClick={() =>
                            toggleActive.mutate({ id: r.id, next: !r.active })
                          }
                        >
                          {r.active ? "Ngừng" : "Áp dụng lại"}
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.footRow}>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Thêm quy tắc
          </Button>
        </div>

        <p className={styles.footnote}>
          Mỗi dòng có nhiều điều kiện: <strong>ngân hàng bắt buộc</strong>,{" "}
          <strong>tổng app</strong>, <strong>kênh</strong>, <strong>mở CNKD/HKD</strong>.
          Khách phải khớp <strong>đủ mọi điều kiện đã đặt</strong> thì dòng mới tính
          — đây là phép VÀ, không phải HOẶC. Ô nào để <strong>“—”</strong> (Không
          yêu cầu) nghĩa là <strong>bỏ qua</strong> điều kiện đó, không phải “khách
          không được có”. Ví dụ dòng 2: ngân hàng = MSBa <em>và</em> tổng app = 3 —
          khách phải vừa cài MSBa vừa đúng 3 app thì mới được 50.000đ; thiếu một
          trong hai thì dòng này không tính.
        </p>

        <p className={styles.footnote}>
          <strong>Bậc thang</strong> khớp dòng có thứ tự nhỏ nhất trước rồi dừng —
          không cộng dồn với các dòng bậc thang khác. <strong>Góp thêm</strong> thì
          mọi dòng khớp đều bỏ món vào rổ. Đặt <strong>hiệu lực đến</strong> khi hết
          chiến dịch, đừng xoá — quy tắc cũ vẫn cần để đối chiếu quà đã trao trong
          quá khứ.
        </p>
      </SectionCard>

      <GiftSimulator />

      {(creating || editing) && (
        <GiftRuleFormDialog
          open
          rule={editing}
          giftItems={giftItems}
          packages={packages}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
