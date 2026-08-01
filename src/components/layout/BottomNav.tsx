"use client";

import { Menu, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { CreateBankAccountDialog } from "@/components/banking/CreateBankAccountDialog";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { CreateInsuranceOrderDialog } from "@/components/insurance/CreateInsuranceOrderDialog";
import { CreateServiceDialog } from "@/components/services/CreateServiceDialog";
import { NavIcon } from "./NavIcon";
import type { NavIconKey } from "@/lib/nav";
import { can } from "@/lib/permissions";
import type { User } from "@/lib/types";
import styles from "./BottomNav.module.scss";

type Entry =
  | { kind: "link"; href: string; label: string; icon: NavIconKey }
  | { kind: "create"; label: string }
  | { kind: "more"; label: string };

type CreateKind = "customer" | "banking" | "insurance" | "services";

const CREATE_OPTIONS: { kind: CreateKind; label: string; icon: NavIconKey; allowed: (u: User) => boolean }[] = [
  { kind: "customer", label: "Tạo khách hàng", icon: "customers", allowed: () => true },
  {
    kind: "banking",
    label: "Mở tài khoản ngân hàng",
    icon: "banking",
    allowed: (u) => can(u, "banking", "create"),
  },
  {
    kind: "insurance",
    label: "Tạo đơn bảo hiểm",
    icon: "insurance",
    allowed: (u) => can(u, "insurance", "create"),
  },
  { kind: "services", label: "Ghi dịch vụ", icon: "services", allowed: (u) => can(u, "services", "create") },
];

/**
 * Thanh điều hướng đáy — chỉ hiện trên điện thoại (CSS ẩn ở desktop). Khác
 * sidebar đầy đủ mọi mục: đây là 3-4 lối tắt hay dùng nhất theo QUYỀN của
 * người đang đăng nhập (không hard-code theo chức danh — cùng nguyên tắc với
 * `navFor` ở sidebar), cộng nút "Thêm" mở lại sidebar đầy đủ. Không thay thế
 * sidebar, chỉ rút ngắn thao tác lặp lại hằng ngày.
 */
export function BottomNav({ user, onOpenMenu }: { user: User; onOpenMenu: () => void }) {
  const pathname = usePathname();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState<CreateKind | null>(null);

  const canCreateBusinessRecord =
    can(user, "banking", "create") || can(user, "insurance", "create") || can(user, "services", "create");
  const managesPeople = user.manageScope !== "none" || can(user, "staff", "create");
  const canSeeOverview =
    can(user, "insurance", "view-summary") ||
    can(user, "banking", "view-summary") ||
    can(user, "services", "view-summary");

  const peopleEntry: Entry = managesPeople
    ? { kind: "link", href: "/people", label: "Nhân sự & KPI", icon: "people" }
    : { kind: "link", href: "/my-target", label: "Chỉ tiêu của tôi", icon: "target" };

  // Tạo được ít nhất một loại bản ghi nghiệp vụ → thao tác hằng ngày là ghi
  // dữ liệu, ưu tiên Khách hàng + Tạo mới. Không tạo được gì (GĐ/PGĐ) → thao
  // tác hằng ngày là xem, ưu tiên Tổng quan + Nhân sự + Phòng ban.
  const entries: Entry[] = canCreateBusinessRecord
    ? [
        { kind: "link", href: "/customers", label: "Khách hàng", icon: "customers" },
        { kind: "create", label: "Tạo mới" },
        peopleEntry,
        { kind: "more", label: "Thêm" },
      ]
    : [
        ...(canSeeOverview ? [{ kind: "link", href: "/", label: "Tổng quan", icon: "overview" } as Entry] : []),
        ...(managesPeople ? [peopleEntry] : []),
        ...(can(user, "system", "manage-org")
          ? [{ kind: "link", href: "/departments", label: "Phòng ban", icon: "org" } as Entry]
          : []),
        { kind: "more", label: "Thêm" },
      ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const createOptions = CREATE_OPTIONS.filter((o) => o.allowed(user));

  return (
    <>
      <nav className={styles.bar} aria-label="Điều hướng nhanh">
        {entries.map((entry) => {
          if (entry.kind === "link") {
            const active = isActive(entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className={[styles.item, active && styles.active].filter(Boolean).join(" ")}
                aria-current={active ? "page" : undefined}
              >
                <NavIcon name={entry.icon} />
                <span>{entry.label}</span>
              </Link>
            );
          }

          if (entry.kind === "create") {
            return (
              <button
                key="create"
                type="button"
                className={styles.item}
                onClick={() => setPickerOpen(true)}
              >
                <Plus size={18} strokeWidth={1.8} aria-hidden />
                <span>{entry.label}</span>
              </button>
            );
          }

          return (
            <button key="more" type="button" className={styles.item} onClick={onOpenMenu}>
              <Menu size={18} strokeWidth={1.8} aria-hidden />
              <span>{entry.label}</span>
            </button>
          );
        })}
      </nav>

      {pickerOpen && (
        <Dialog open onClose={() => setPickerOpen(false)} title="Tạo mới">
          <ul className={styles.pickerList}>
            {createOptions.map((o) => (
              <li key={o.kind}>
                <button
                  type="button"
                  className={styles.pickerRow}
                  onClick={() => {
                    setPickerOpen(false);
                    setCreating(o.kind);
                  }}
                >
                  <NavIcon name={o.icon} />
                  <span>{o.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {creating === "customer" && (
        <CustomerFormDialog open onClose={() => setCreating(null)} />
      )}
      {creating === "banking" && (
        <CreateBankAccountDialog open onClose={() => setCreating(null)} />
      )}
      {creating === "insurance" && (
        <CreateInsuranceOrderDialog open onClose={() => setCreating(null)} />
      )}
      {creating === "services" && (
        <CreateServiceDialog open onClose={() => setCreating(null)} />
      )}
    </>
  );
}
