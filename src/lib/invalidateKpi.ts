import type { QueryClient } from "@tanstack/react-query";

/**
 * Làm mới mọi nơi HIỂN THỊ ĐIỂM KPI.
 *
 * Máy chủ gọi `recomputeKpi` sau mỗi thao tác đổi dữ liệu tính điểm — hoàn tất
 * tài khoản ngân hàng, ghi/sửa/xoá dịch vụ. Nhưng số đã tính lại nằm im trong
 * database cho tới khi trình duyệt hỏi lại; không gọi hàm này thì người dùng
 * đang mở bảng nhân sự ở tab khác vẫn thấy số cũ, và tưởng thao tác vừa rồi
 * không ăn thua.
 *
 * Ba khoá vì điểm hiện ở ba chỗ: bảng nhân sự P-51 (`staff`), hồ sơ một người
 * P-52 (`person`), và trang tổng quan P-01 (`dashboard`, chưa xây nhưng khoá đã
 * đặt sẵn — thêm sau này khỏi phải đi tìm lại đủ 5 nơi gọi).
 */
export function invalidateKpi(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["staff"] });
  queryClient.invalidateQueries({ queryKey: ["person"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}
