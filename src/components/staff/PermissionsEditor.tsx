"use client";

import { Select } from "@/components/ui/Select";
import { grantScopeFor } from "@/lib/permissions";
import {
  ACTION_LABEL,
  BASE_ACTIONS,
  EDITABLE_MODULES,
  MODULE_LABEL,
  SCOPE_LABEL,
  SCOPES,
  SPECIAL_ACTIONS_OF,
  type Action,
  type ModuleKey,
  type Permission,
  type Scope,
  type User,
} from "@/lib/types";
import styles from "./PermissionsEditor.module.scss";

type Props = {
  value: Permission[];
  onChange: (permissions: Permission[]) => void;
  /** Người đang cấp quyền — dùng để giới hạn lựa chọn không vượt quá quyền của chính họ (mục 1.1.0). */
  actor: User | null;
};

/** `system` không có bản ghi để CRUD — chỉ có hành động đặc biệt. */
function actionsForModule(module: ModuleKey): Action[] {
  const base = module === "system" ? [] : BASE_ACTIONS;
  const special = SPECIAL_ACTIONS_OF[module] ?? [];
  return [...base, ...special];
}

const rank = (s: Scope) => SCOPES.indexOf(s);

/** Ô vuông bo góc nhẹ trước mỗi select — đổi màu theo phạm vi, cùng tông cam sẵn có. */
const SCOPE_MARK_CLASS: Record<Scope | "", string> = {
  "": styles.markNone,
  own: styles.markOwn,
  managed: styles.markManaged,
  company: styles.markCompany,
};

/**
 * Lưới cấp quyền lẻ theo (module, hành động, phạm vi) — dùng ở P-92 và thẻ
 * "Quyền" trên hồ sơ nhân viên. Không hiện module `*`: cấp nguyên module đó
 * cho một người cụ thể là quá rộng để làm bằng tay, chỉ có ở bộ quyền Giám đốc.
 */
export function PermissionsEditor({ value, onChange, actor }: Props) {
  const findScope = (module: ModuleKey, action: Action): Scope | "" =>
    value.find((p) => p.module === module && p.action === action)?.scope ?? "";

  const setScope = (module: ModuleKey, action: Action, scope: Scope | "") => {
    const next = value.filter((p) => !(p.module === module && p.action === action));
    onChange(scope ? [...next, { module, action, scope }] : next);
  };

  return (
    <div className={styles.grid}>
      {EDITABLE_MODULES.map((module) => (
        <div key={module} className={styles.module}>
          <h4 className={styles.moduleTitle}>{MODULE_LABEL[module]}</h4>

          {actionsForModule(module).map((action) => {
            // Ngoại lệ đã chốt (spec §2.1b): xem hồ sơ khách hàng luôn mở toàn
            // công ty, không ai cấp/thu hồi riêng lẻ được.
            if (module === "customer" && action === "view-detail") {
              return (
                <div key={action} className={styles.row}>
                  <span className={styles.actionLabel}>{ACTION_LABEL[action]}</span>
                  <span className={`${styles.mark} ${styles.markCompany}`} aria-hidden="true" />
                  <span className={styles.locked}>Toàn công ty · luôn mở</span>
                </div>
              );
            }

            const max = grantScopeFor(actor, module, action);
            const current = findScope(module, action);
            // Luôn hiện đúng giá trị thật đang có, kể cả khi nó vượt quá tầm
            // actor tự cấp được (vd đang xem người có sẵn quyền rộng hơn
            // mình) — không cho CHỌN THÊM cái mới vượt tầm, nhưng không giấu
            // giá trị cũ đi. Máy chủ vẫn chặn lại nếu bấm lưu (mục 1.1.0).
            const allowed = SCOPES.filter(
              (s) => (max !== null && rank(s) <= rank(max)) || s === current,
            );

            return (
              <div key={action} className={styles.row}>
                <span className={styles.actionLabel}>{ACTION_LABEL[action]}</span>
                <span className={`${styles.mark} ${SCOPE_MARK_CLASS[current]}`} aria-hidden="true" />
                <Select
                  label={ACTION_LABEL[action]}
                  hideLabel
                  value={current}
                  onChange={(v) => setScope(module, action, v as Scope | "")}
                  options={[
                    { value: "", label: "Không có" },
                    ...allowed.map((s) => ({ value: s, label: SCOPE_LABEL[s] })),
                  ]}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
