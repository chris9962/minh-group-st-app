"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as InputKey,
} from "react";
import { NavIcon } from "./NavIcon";
import { useDebouncedValue } from "@/lib/hooks";
import {
  fetchJumpHits,
  jumpSourcesFor,
  shouldSearchRecords,
  type JumpHit,
} from "@/lib/jump-search";
import {
  FEEDBACK_HREF,
  OPEN_FEEDBACK_EVENT,
  filterJumpTargets,
  jumpActionsFor,
  jumpTargetsFrom,
  navFor,
  type JumpTarget,
} from "@/lib/nav";
import { useDialogLayer } from "@/store/dialogLayer";
import { useSession } from "@/store/session";
import styles from "./JumpSearch.module.css";

type JumpRow = JumpTarget & { detail?: string; key?: string };

/**
 * Ô tìm trên thanh trên — việc đã làm được, màn sidebar, rồi bản ghi khớp
 * đúng ô tìm từng danh sách (khách, STK/mã, đơn BH, dịch vụ, phòng, nhân sự).
 */
export function JumpSearch() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const delayed = useDebouncedValue(query, 300);
  const sources = jumpSourcesFor(user);
  const showHits = shouldSearchRecords(query);
  const queryReady = delayed.trim() === query.trim();
  const { data: records = [], isFetching } = useQuery({
    queryKey: ["jump-records", delayed, sources],
    queryFn: () => fetchJumpHits(sources, delayed.trim()),
    enabled: open && shouldSearchRecords(delayed),
    staleTime: 15_000,
  });
  /** Không giữ kết quả câu cũ — gõ "phòng" mà vẫn thấy khách lần trước thì tưởng ô tìm hỏng. */
  const hits: JumpHit[] = showHits && queryReady ? records : [];
  const searching = showHits && (!queryReady || isFetching);

  const actions = filterJumpTargets(jumpActionsFor(user), query);
  const pages = filterJumpTargets(jumpTargetsFrom(navFor(user)), query);
  const results: JumpRow[] = [...actions, ...pages, ...hits];
  const current = results.length === 0 ? -1 : Math.min(active, results.length - 1);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };

  const go = (href: string) => {
    close();
    if (href === FEEDBACK_HREF) {
      window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT));
      return;
    }
    if (typeof window !== "undefined") {
      const next = new URL(href, window.location.origin);
      if (next.searchParams.get("create") === "1" && next.pathname === window.location.pathname) {
        const params = new URLSearchParams(window.location.search);
        params.set("create", "1");
        router.push(`${next.pathname}?${params.toString()}`);
        return;
      }
    }
    router.push(href);
  };

  const openSearch = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  /**
   * `showModal` trước khi trình duyệt vẽ — nếu để `useEffect` thì một nhịp
   * hộp thoại đã hiện xong rồi mới có nội dung, nhìn giật.
   */
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      useDialogLayer.getState().push(el);
      inputRef.current?.focus();
    }
    if (!open && el.open) el.close();
    if (!open) return;
    return () => {
      useDialogLayer.getState().pop(el);
    };
  }, [open]);

  const onQueryKey = (e: InputKey<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      const next = (current + 1) % results.length;
      setActive(next);
      requestAnimationFrame(() => {
        document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      const next = (current - 1 + results.length) % results.length;
      setActive(next);
      requestAnimationFrame(() => {
        document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[current];
      if (hit) go(hit.href);
    }
  };

  const shortcut =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘K"
      : "Ctrl+K";

  const renderItem = (item: JumpRow, index: number) => (
    <li key={item.key ?? item.href} role="presentation">
      <button
        type="button"
        id={`${listId}-${index}`}
        role="option"
        aria-selected={index === current}
        className={styles.item}
        onMouseEnter={() => setActive(index)}
        onClick={() => go(item.href)}
      >
        <span className={styles.itemIcon}>
          <NavIcon name={item.icon} />
        </span>
        <span className={styles.itemText}>
          <span className={styles.itemLabel}>{item.label}</span>
          {(item.detail || item.group) && (
            <span className={styles.itemGroup}>{item.detail || item.group}</span>
          )}
        </span>
      </button>
    </li>
  );

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-label="Tìm hoặc chuyển đến"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={openSearch}
      >
        <Search size={18} aria-hidden />
      </button>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label="Tìm hoặc chuyển đến"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        {open && (
          <div className={styles.panel}>
            <div className={styles.searchRow}>
              <Search size={18} aria-hidden className={styles.searchIcon} />
              <input
                ref={inputRef}
                className={styles.field}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onQueryKey}
                placeholder="Tìm khách, mã, phòng, màn…"
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={
                  current >= 0 ? `${listId}-${current}` : undefined
                }
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className={styles.shortcut}>{shortcut}</kbd>
            </div>

            {results.length === 0 && !searching ? (
              <p className={styles.empty}>Không có mục nào khớp.</p>
            ) : (
              <ul id={listId} className={styles.list} role="listbox">
                {actions.map((item, index) => renderItem(item, index))}
                {actions.length > 0 && (pages.length > 0 || hits.length > 0) && (
                  <li className={styles.split} role="separator" />
                )}
                {pages.map((item, i) => renderItem(item, actions.length + i))}
                {pages.length > 0 && hits.length > 0 && (
                  <li className={styles.split} role="separator" />
                )}
                {hits.map((item, i) =>
                  renderItem(item, actions.length + pages.length + i),
                )}
                {searching && hits.length === 0 && (
                  <li className={styles.hint}>Đang tìm…</li>
                )}
              </ul>
            )}

            <p className={styles.foot}>
              Mũi tên để chọn · Enter để mở
            </p>
          </div>
        )}
      </dialog>
    </>
  );
}
