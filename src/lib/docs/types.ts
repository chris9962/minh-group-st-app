import type { User } from '@/lib/types';

/**
 * Bài hướng dẫn là DỮ LIỆU TĨNH trong repo, không phải bản ghi DB: nội dung đổi
 * theo tính năng nên phải đi cùng commit đổi tính năng đó. Vài chục bài do
 * người viết tay — danh mục đóng theo AGENTS.md §5.1, nên tìm kiếm/lọc chạy ở
 * trình duyệt là hợp lệ.
 */

/** Một vòng tròn đánh số trên ảnh. Toạ độ tính bằng % của khung ảnh. */
export type DocMarker = {
  n: number;
  x: number;
  y: number;
  /** Lời giải thích hiện ở chú giải bên dưới ảnh. */
  label: string;
};

export type DocShot = {
  /** Đường dẫn dưới `public/`, ví dụ `/docs/referral-code-form.png`. */
  src: string;
  alt: string;
  /** Kích thước gốc của ảnh — giữ đúng tỉ lệ khung, tránh giật bố cục lúc tải. */
  width: number;
  height: number;
  markers: DocMarker[];
};

export type DocBlock =
  | { kind: 'text'; body: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'note'; tone: 'info' | 'warning'; body: string }
  | { kind: 'shot'; shot: DocShot };

export type DocGroupKey = 'daily' | 'people' | 'config' | 'data';

export type DocArticle = {
  slug: string;
  title: string;
  /** Mã màn hình trong mgst-feature-list.md — để đối chiếu khi rà soát. */
  screen?: string;
  group: DocGroupKey;
  summary: string;
  /** Cụm từ người dùng hay gõ khi tìm — cộng thêm vào khoá tìm kiếm. */
  keywords: string[];
  /**
   * Ai thấy bài này. PHẢI trùng điều kiện mở màn tương ứng ở `lib/nav.ts` —
   * hai nơi lệch nhau thì bài hướng dẫn dạy một màn người đọc không mở được.
   */
  visibleTo: (user: User) => boolean;
  blocks: DocBlock[];
};
