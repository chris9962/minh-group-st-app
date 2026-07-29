import { useEffect, useState } from 'react';

/**
 * Hoãn giá trị lại `delay` ms.
 *
 * Gõ tìm kiếm mà bắn query theo từng phím thì một từ khoá 10 ký tự là 10 lượt
 * gọi máy chủ. Đây là đồng bộ với bộ đếm giờ của trình duyệt nên effect đúng
 * chỗ; cleanup huỷ hẹn giờ cũ mỗi lần gõ tiếp.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
