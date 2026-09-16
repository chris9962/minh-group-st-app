"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { RELEASES } from "@/lib/releases";
import styles from "./page.module.scss";

/**
 * P-98 · Danh sách bản cập nhật, mới nhất đứng đầu.
 *
 * Không có trên sidebar: người dùng tới đây từ thông báo hoặc hộp thoại
 * `ReleaseGate`. Dữ liệu là mảng tĩnh trong bản dựng, không gọi máy chủ.
 */
export default function ReleasesPage() {
  return (
    <>
      <TopBar title="Bản cập nhật" keepTitleOnMobile />
      <main className={styles.body}>
        <ul className={styles.cards}>
          {RELEASES.map((release) => (
            <li key={release.id}>
              <Link href={`/releases/${release.id}`} className={styles.card}>
                <span className={styles.cardText}>
                  <span className={styles.cardTitle}>{release.title}</span>
                  <span className={styles.cardSummary}>{release.summary}</span>
                </span>
                <ChevronRight size={16} aria-hidden className={styles.cardArrow} />
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
