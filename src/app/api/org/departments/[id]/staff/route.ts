import { STAFF_SORT, type StaffQuery } from "@/lib/api/staff";
import { can } from "@/lib/permissions";
import { forbidden, getActor, isUuid, notFound, unauthorized } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { staffFor } from "@/server/staff";

type Params = { params: Promise<{ id: string }> };

/**
 * Trần dòng của route này — con số an toàn, KHÔNG phải cỡ trang.
 *
 * Phòng lớn nhất có 30 người, đo trên production 2026-09-03. Vượt 500 nghĩa là
 * cấu trúc tổ chức đã khác hẳn giả định, và trang chi tiết phòng ban phải quay
 * lại phân trang máy chủ. `total` trong payload lớn hơn `rows.length` là dấu
 * hiệu nhận ra ca đó.
 */
const CAP = 500;

/**
 * TRỌN danh sách nhân viên của MỘT phòng, cho trang chi tiết phòng ban.
 *
 * Route riêng chứ không phải tham số "lấy hết" của `/api/staff` (AGENTS.md §5.1
 * điều 4). Trình duyệt tự sắp trên dữ liệu này — xem `fetchDepartmentStaff` cho
 * lý do bỏ phân trang.
 *
 * Gác bằng `staff:view-detail` với đúng lý do đã ghi ở `/api/staff`: `staffFor`
 * kẹp phạm vi theo quyền đó, và payload gồm số điện thoại cùng bảng quyền.
 */
export async function GET(request: Request, { params }: Params) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "view-detail")) return forbidden();

  const { id } = await params;
  // Id sai dạng uuid đi thẳng vào SQL là `22P02` → 500. Một bookmark hỏng chỉ
  // nên ra "không có phòng này".
  if (!isUuid(id)) return notFound();

  const url = new URL(request.url);
  const query: Omit<StaffQuery, "page" | "sort" | "dir"> = {
    // `staffFor` hạ phạm vi này về mức thật của người gọi. Phòng ngoài phạm vi
    // cho ra bảng rỗng, không phải 403 — trang còn phân biệt hai ca đó bằng câu
    // hiện lúc bảng rỗng.
    scope: "company",
    departmentId: id,
    search: "",
    // Bảng này không có cột Chỉ tiêu nên để máy chủ tự lấy tháng làm việc.
    summaryMonth: "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    // Cả người đã khoá: họ vẫn có số của kỳ đang xem, bỏ đi thì tổng điểm phòng
    // ở tiêu đề khối không khớp tổng cột Điểm.
    status: "all",
    roles: [],
  };

  return Response.json(
    // Sắp theo chức vụ để Trưởng và Phó phòng nằm đầu bảng lúc mới mở. Trình
    // duyệt đổi thứ tự sau đó, nên `sort`/`dir` trên URL không có tác dụng gì.
    await staffFor(actor, query, pageArgsFrom(url, STAFF_SORT, "role", CAP)),
  );
}
