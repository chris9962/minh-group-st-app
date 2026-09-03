import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchProvinces } from '@/lib/api/wardCatalog';

/**
 * Danh sách gợi ý cho mọi ô địa chỉ trong app (chốt 2026-09-03).
 *
 * Thứ tự NHỎ TRƯỚC LỚN SAU — `Ấp, Xã, Tỉnh` — đúng cách người Việt đọc một địa
 * chỉ. Bản trước ghép ngược lại và chỉ dùng ở hồ sơ khách, nên ô địa chỉ trên
 * đơn bảo hiểm gõ tay ra một dạng khác hẳn.
 *
 * Xã chưa có ấp nào vẫn có gợi ý mức xã: nhân viên chọn được `Xã, Tỉnh` rồi gõ
 * thêm phần còn lại.
 *
 * Một lượt tải cho cả danh mục rồi ghép tại chỗ. Danh mục là bảng đóng vài
 * nghìn dòng, và `queryKey` dùng chung nên mọi hộp thoại đọc lại cùng một bản.
 */
export function useAddressSuggestions(enabled = true): string[] {
  const { data: provinces = [] } = useQuery({
    queryKey: ['provinces'],
    queryFn: fetchProvinces,
    enabled,
  });

  return useMemo(
    () =>
      provinces.flatMap((p) =>
        p.wards.flatMap((w) => [
          `${w.name}, ${p.name}`,
          ...w.hamlets.map((h) => `${h.name}, ${w.name}, ${p.name}`),
        ]),
      ),
    [provinces],
  );
}
