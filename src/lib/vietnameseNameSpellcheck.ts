import { removeDiacritics } from '@/lib/format';
import { vietnameseSyllables } from '@/lib/data/vietnameseSyllables';

/**
 * Chỉ đưa ra gợi ý rà soát: tên riêng, tên dân tộc và tên nước ngoài có thể
 * không nằm trong từ điển. Giữ nguyên dấu cách để làm nổi đúng tiếng cần xem.
 */
export function spellingPartsForName(name: string): { text: string; suspicious: boolean }[] {
  return name.split(/(\s+)/u).map((text) => ({
    text,
    suspicious:
      Boolean(text.trim()) &&
      (!/^[\p{L}\p{M}]+$/u.test(text) ||
        !vietnameseSyllables.has(removeDiacritics(text).toLowerCase())),
  }));
}
