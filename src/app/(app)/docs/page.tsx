"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { SearchField } from "@/components/ui/SearchField";
import { DOC_GROUPS, docsFor, searchDocs } from "@/lib/docs";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * P-95 · Hướng dẫn sử dụng.
 *
 * Danh sách bài lọc theo QUYỀN: mỗi bài mang điều kiện trùng với điều kiện hiện
 * màn tương ứng trên sidebar, nên nhân viên chỉ gặp hướng dẫn của những màn
 * mình mở được. Không có gọi máy chủ nào — bài là dữ liệu tĩnh trong bản dựng.
 */
export default function DocsPage() {
  const user = useSession((s) => s.user);
  const [query, setQuery] = useState("");

  const visible = docsFor(user);
  const matched = searchDocs(visible, query);

  return (
    <>
      <TopBar title="Hướng dẫn sử dụng" keepTitleOnMobile />
      <main className={styles.body}>
        <div className={styles.search}>
          <SearchField
            label="Tìm bài hướng dẫn"
            placeholder="Ví dụ: thêm mã giới thiệu, tạo nhân viên…"
            value={query}
            onChange={setQuery}
            block
          />
        </div>

        {matched.length === 0 ? (
          <p className={styles.empty}>
            Không có bài nào khớp với “{query}”. Bạn thử gõ tên màn hoặc tên nút,
            ví dụ “mã giới thiệu”.
          </p>
        ) : (
          DOC_GROUPS.map((group) => {
            const articles = matched.filter((a) => a.group === group.key);
            if (articles.length === 0) return null;
            return (
              <section key={group.key} className={styles.group}>
                <h2 className={styles.groupTitle}>{group.label}</h2>
                <ul className={styles.cards}>
                  {articles.map((article) => (
                    <li key={article.slug}>
                      <Link href={`/docs/${article.slug}`} className={styles.card}>
                        <span className={styles.cardText}>
                          <span className={styles.cardTitle}>{article.title}</span>
                          <span className={styles.cardSummary}>{article.summary}</span>
                        </span>
                        <ChevronRight size={16} aria-hidden className={styles.cardArrow} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </main>
    </>
  );
}
