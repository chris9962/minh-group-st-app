"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { use } from "react";
import { RequirePermission } from "@/components/layout/RequirePermission";
import { TopBar } from "@/components/layout/TopBar";
import { DocBlocks } from "@/components/docs/DocBlocks";
import { docBySlug } from "@/lib/docs";
import styles from "./page.module.scss";

/**
 * P-95 · Một bài hướng dẫn.
 *
 * Gác bằng đúng điều kiện `visibleTo` của bài — trùng điều kiện lọc ở danh
 * sách, nên đường dẫn gõ tay cũng không mở được bài ngoài quyền. Đây là chốt
 * chặn giao diện cho gọn trải nghiệm; bài không chứa dữ liệu nghiệp vụ nào.
 */
export default function DocArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const article = docBySlug(slug);
  if (!article) notFound();

  return (
    <RequirePermission allow={(user) => user !== null && article.visibleTo(user)}>
      <TopBar title={article.title} keepTitleOnMobile />
      <main className={styles.body}>
        <Link href="/docs" className={styles.back}>
          <ChevronLeft size={15} aria-hidden />
          Hướng dẫn
        </Link>

        <DocBlocks blocks={article.blocks} />
      </main>
    </RequirePermission>
  );
}
