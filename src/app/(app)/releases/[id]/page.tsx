"use client";

import { notFound } from "next/navigation";
import { use } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { BackLink } from "@/components/ui/BackLink";
import { releaseById, sectionsFor } from "@/lib/releases";
import { useSession } from "@/store/session";
import styles from "./page.module.scss";

/**
 * P-98 · Một bản cập nhật: mọi thay đổi của lần deploy đó.
 *
 * Mục lọc theo QUYỀN như bài hướng dẫn: nhân viên không đọc thay đổi của màn
 * mình không mở được. Trang không chứa dữ liệu nghiệp vụ nên không gác gì thêm.
 */
export default function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useSession((s) => s.user);
  const release = releaseById(id);
  if (!release) notFound();

  const sections = sectionsFor(release, user);

  return (
    <>
      <TopBar title={release.title} keepTitleOnMobile />
      <main className={styles.body}>
        <BackLink href="/releases">Bản cập nhật</BackLink>

        <p className={styles.summary}>{release.summary}</p>

        {sections.map((section) => (
          <section key={section.title} className={styles.section}>
            <h2 className={styles.sectionTitle}>{section.title}</h2>
            <ul className={styles.items}>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
