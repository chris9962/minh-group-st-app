import type { User } from '@/lib/types';

/**
 * Bản cập nhật là DỮ LIỆU TĨNH trong repo, cùng cách với bài hướng dẫn
 * (`lib/docs`): nội dung mô tả đúng bản dựng đang chạy nên phải đi cùng commit.
 *
 * Gửi thông báo cho nhân viên là việc của script `db:announce-release`, chạy
 * sau khi deploy. Trang `/releases` chỉ đọc mảng này, không gọi máy chủ.
 */

export type ReleaseSection = {
  title: string;
  /**
   * Mỗi dòng một ý, viết cho NHÂN VIÊN đọc: tình huống họ gặp, luật mới, và
   * họ phải làm gì. Không ghi thay đổi kỹ thuật hay thay đổi của màn quản trị
   * mà nhân viên không dùng (chốt 2026-09-16).
   */
  items: string[];
  /**
   * Ai thấy mục này. Bỏ trống là mọi người. Mục về màn quản trị thì gắn đúng
   * điều kiện mở màn đó ở `lib/nav.ts`, để nhân viên không đọc thay đổi của
   * màn mình không mở được.
   */
  visibleTo?: (user: User) => boolean;
};

export type Release = {
  /** Ngày deploy dạng `YYYY-MM-DD`, cũng là đường dẫn `/releases/<id>`. */
  id: string;
  title: string;
  /** Tóm tắt 1-2 câu, đi vào thân thông báo và hộp thoại che màn hình. */
  summary: string;
  sections: ReleaseSection[];
};
