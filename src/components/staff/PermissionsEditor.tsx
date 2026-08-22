"use client";

import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { canGrantFullAccess, grantScopeFor, isFullAccess } from "@/lib/permissions";
import { fullPermissions } from "@/lib/roles";
import {
  ACTION_LABEL,
  BASE_ACTIONS,
  EDITABLE_MODULES,
  MODULE_LABEL,
  SCOPE_LABEL,
  SCOPES,
  SCOPELESS_ACTIONS,
  SPECIAL_ACTIONS_OF,
  type Action,
  type ModuleKey,
  type Permission,
  type Scope,
  type User,
} from "@/lib/types";
import { useState } from "react";
import styles from "./PermissionsEditor.module.scss";

type Props = {
  value: Permission[];
  onChange: (permissions: Permission[]) => void;
  /** Người đang cấp quyền — dùng để giới hạn lựa chọn không vượt quá quyền của chính họ (mục 1.1.0). */
  actor: User | null;
};

/** `system` không có bản ghi để CRUD — chỉ có hành động đặc biệt. */
function actionsForModule(module: ModuleKey): Action[] {
  // `department` không có đường xuất Excel nào — bày ô đó ra là hứa một tính
  // năng không tồn tại, cấp xong vẫn không có nút nào hiện thêm.
  const base =
    module === "system"
      ? []
      : module === "department"
        ? BASE_ACTIONS.filter((a) => a !== "export")
        : BASE_ACTIONS;
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
  const full = isFullAccess(value);
  const canGrantFull = canGrantFullAccess(actor);

  /**
   * Bộ quyền lẻ trước lúc bật công tắc, để tắt là trả lại đúng như cũ.
   *
   * Bật "Toàn quyền" ghi đè cả danh sách bằng 15 dòng `*`. Không giữ bản cũ thì
   * người bật nhầm phải tích lại từ đầu mấy chục ô.
   */
  const [manual, setManual] = useState<Permission[]>(full ? [] : value);

  const findScope = (module: ModuleKey, action: Action): Scope | "" =>
    value.find((p) => p.module === module && p.action === action)?.scope ?? "";

  const setScope = (module: ModuleKey, action: Action, scope: Scope | "") => {
    const next = value.filter((p) => !(p.module === module && p.action === action));
    onChange(scope ? [...next, { module, action, scope }] : next);
  };

  const toggleFull = (on: boolean) => {
    if (on) {
      setManual(value);
      onChange(fullPermissions);
      return;
    }
    onChange(manual);
  };

  return (
    <div className={styles.grid}>
      <div className={styles.fullRow}>
        <Switch
          label="Toàn quyền"
          checked={full}
          disabled={!canGrantFull}
          onCheckedChange={toggleFull}
          hint={
            canGrantFull
              ? "Mọi module, toàn công ty, cấp được quyền cho người khác. Bật lên thì không phải chọn tay từng ô."
              : "Chỉ tài khoản đang có quyền cấp quyền mới bật được công tắc này."
          }
        />
      </div>

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
            // Toàn quyền là 15 dòng module `*`, không có dòng nào mang tên
            // module này — hiện thẳng mức công ty thay vì để ô trống, không thì
            // lưới trông như chưa cấp gì trong khi người này có mọi quyền.
            const current = full ? "company" : findScope(module, action);

            /**
             * Hành động không chia được theo phạm vi — chỉ Bật/Tắt.
             *
             * Hiện ba mức phạm vi cho `manage-org` là mời người ta cấp một
             * quyền trông như hẹp mà thật ra không: nhật ký truy vết không cắt
             * theo phòng được, ai bật cũng đọc trọn công ty.
             */
            if (SCOPELESS_ACTIONS.includes(action)) {
              const on = full || current !== "";
              return (
                <div key={action} className={styles.row}>
                  <span className={styles.actionLabel}>{ACTION_LABEL[action]}</span>
                  <span
                    className={`${styles.mark} ${on ? styles.markCompany : styles.markNone}`}
                    aria-hidden="true"
                  />
                  <Select
                    label={ACTION_LABEL[action]}
                    hideLabel
                    value={on ? "company" : ""}
                    // Không tự cấp được thì không bật được — `max` là trần phát
                    // của chính người đang thao tác. Toàn quyền thì khoá hết:
                    // công tắc đã quyết, sửa lẻ ở đây không đổi được gì.
                    disabled={full || (max === null && !on)}
                    onChange={(v) => setScope(module, action, v ? "company" : "")}
                    options={[
                      { value: "", label: "Không có" },
                      { value: "company", label: "Có · toàn công ty" },
                    ]}
                  />
                </div>
              );
            }
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
                  disabled={full}
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
