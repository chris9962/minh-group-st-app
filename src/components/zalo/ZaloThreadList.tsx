"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Phone, User, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SearchField } from "@/components/ui/SearchField";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { SkeletonTable } from "@/components/ui/Skeleton";
import type { Page } from "@/lib/api/pagination";
import {
  fetchZaloContacts,
  fetchZaloGroups,
  ZALO_THREAD_TYPE_LABEL,
  ZaloThreadType,
} from "@/lib/api/zaloBot";
import { digitsOnly, formatCount, formatPhone, isValidPhone } from "@/lib/format";
import { useDebouncedValue } from "@/lib/hooks";
import styles from "./ZaloThreadList.module.scss";

/** Nơi nhận đang mở trong khung chat. `phone` là số chưa tra ra uid. */
export type ZaloChatTarget =
  | { kind: "group"; id: string; name: string; memberCount: number }
  | { kind: "user"; id: string; name: string; phone: string }
  | { kind: "phone"; phone: string };

export const chatTargetKey = (t: ZaloChatTarget): string =>
  t.kind === "phone" ? `phone:${t.phone}` : `${t.kind}:${t.id}`;

type Props = {
  accountId: string;
  /** Giờ worker tải nhóm và bạn bè lần gần nhất. Đổi thì danh sách đọc lại. */
  syncedAt: string;
  selected: ZaloChatTarget | null;
  onSelect: (target: ZaloChatTarget) => void;
  /** Nút đứng cạnh bộ lọc, ví dụ nút tải lại danh sách. */
  action?: React.ReactNode;
};

const KIND_OPTIONS = ZaloThreadType.options.map((value) => ({
  value,
  label: ZALO_THREAD_TYPE_LABEL[value],
}));

/**
 * Đếm dòng đã tải chứ không nhân `PAGE_SIZE` với số trang: trang cuối thường
 * không đủ cỡ, và phép nhân đó sinh ra một trang rỗng.
 */
function nextPage<T>(last: Page<T>, all: Page<T>[]): number | undefined {
  const loaded = all.reduce((n, p) => n + p.rows.length, 0);
  return loaded < last.total ? all.length : undefined;
}

export function ZaloThreadList({ accountId, syncedAt, selected, onSelect, action }: Props) {
  const [kind, setKind] = useState<ZaloThreadType>("group");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search);

  const groups = useInfiniteQuery({
    queryKey: ["zalo-bot", "groups", accountId, syncedAt, query],
    queryFn: ({ pageParam }) =>
      fetchZaloGroups({ page: pageParam, sort: "name", dir: "asc" }, query),
    initialPageParam: 0,
    getNextPageParam: nextPage,
    enabled: kind === "group",
  });

  const contacts = useInfiniteQuery({
    queryKey: ["zalo-bot", "contacts", accountId, syncedAt, query],
    queryFn: ({ pageParam }) =>
      fetchZaloContacts({ page: pageParam, sort: "name", dir: "asc" }, query),
    initialPageParam: 0,
    getNextPageParam: nextPage,
    enabled: kind === "user",
    // Worker lưu số mới vài giây sau khi gửi theo số điện thoại.
    refetchInterval: 15_000,
  });

  const active = kind === "group" ? groups : contacts;
  const groupRows = groups.data?.pages.flatMap((p) => p.rows) ?? [];
  const contactRows = contacts.data?.pages.flatMap((p) => p.rows) ?? [];
  const rowCount = kind === "group" ? groupRows.length : contactRows.length;

  const typedPhone = /^[\d\s.]+$/.test(query.trim()) ? digitsOnly(query) : "";
  const newPhone =
    kind === "user" &&
    contacts.isSuccess &&
    isValidPhone(typedPhone) &&
    !contactRows.some((c) => c.phone === typedPhone)
      ? typedPhone
      : "";

  const selectedKey = selected ? chatTargetKey(selected) : "";

  return (
    <div className={styles.list}>
      <div className={styles.controls}>
        <div className={styles.filterRow}>
          <SegmentedTabs
            label="Loại nơi nhận"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(v) => setKind(ZaloThreadType.catch("group").parse(v))}
          />
          {action}
        </div>
        <SearchField
          block
          label={kind === "group" ? "Tìm nhóm" : "Tìm cá nhân"}
          placeholder={kind === "group" ? "Tên nhóm hoặc Thread ID" : "Tên, số điện thoại hoặc Thread ID"}
          value={search}
          onChange={setSearch}
        />
      </div>

      <div className={styles.scroll}>
        {active.isError ? (
          <ErrorState
            what={kind === "group" ? "danh sách nhóm" : "danh sách cá nhân"}
            onRetry={active.refetch}
            retrying={active.isFetching}
          />
        ) : active.isPending ? (
          <SkeletonTable rows={6} columns={1} />
        ) : (
          <>
            <ul className={styles.items}>
              {newPhone && (
                <li>
                  <Item
                    icon={<Phone size={16} aria-hidden />}
                    name={formatPhone(newPhone)}
                    sub="Số điện thoại"
                    active={selectedKey === `phone:${newPhone}`}
                    onClick={() => onSelect({ kind: "phone", phone: newPhone })}
                  />
                </li>
              )}
              {kind === "group"
                ? groupRows.map((g) => (
                    <li key={g.id}>
                      <Item
                        icon={<Users size={16} aria-hidden />}
                        name={g.name}
                        sub={`${formatCount(g.memberCount)} thành viên`}
                        active={selectedKey === `group:${g.id}`}
                        onClick={() =>
                          onSelect({ kind: "group", id: g.id, name: g.name, memberCount: g.memberCount })
                        }
                      />
                    </li>
                  ))
                : contactRows.map((c) => (
                    <li key={c.phone}>
                      <Item
                        icon={<User size={16} aria-hidden />}
                        name={c.name || formatPhone(c.phone)}
                        sub={c.name ? formatPhone(c.phone) : `Thread ID ${c.uid}`}
                        active={selectedKey === `user:${c.uid}`}
                        onClick={() =>
                          onSelect({ kind: "user", id: c.uid, name: c.name, phone: c.phone })
                        }
                      />
                    </li>
                  ))}
            </ul>

            {rowCount === 0 && !newPhone && (
              <p className={styles.empty}>
                {query
                  ? "Không có kết quả khớp."
                  : kind === "group"
                    ? "Chưa có nhóm nào."
                    : "Chưa có số điện thoại nào."}
              </p>
            )}

            {active.hasNextPage && (
              <div className={styles.more}>
                <Button
                  variant="ghost"
                  onClick={() => active.fetchNextPage()}
                  disabled={active.isFetchingNextPage}
                >
                  Xem thêm
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Item({
  icon,
  name,
  sub,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(styles.item, active && styles.active)}
      aria-current={active || undefined}
      onClick={onClick}
    >
      <span className={styles.avatar}>{icon}</span>
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        <span className={styles.sub}>{sub}</span>
      </span>
    </button>
  );
}
