import { STAFF_SORT, StaffForm, type StaffQuery } from "@/lib/api/staff";
import { can, inVisibleScope } from "@/lib/permissions";
import { RoleKey } from "@/lib/types";
import { logAudit } from "@/server/audit";
import { badRequest, forbidden, getActor, jsonBody, unauthorized, uuidParam } from "@/server/auth";
import { pageArgsFrom } from "@/server/pagination";
import { isYearMonth } from "@/server/people";
import { createStaff, saveError, staffFor } from "@/server/staff";

export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  // Thiếu chốt này thì `clampScope` rơi về `own`, mà `own` lại là CẢ PHÒNG —
  // nhân viên kinh doanh không có quyền nào vẫn lấy được danh sách đồng nghiệp
  // kèm bảng quyền của từng người.
  //
  // Hỏi `view-detail` chứ không phải `view-summary`: `staffFor` kẹp phạm vi
  // theo `view-detail`, và payload trả về gồm số điện thoại + nguyên bảng
  // quyền — đúng thứ route một-bản-ghi bắt phải có `view-detail`. Chốt vào một
  // đằng, kẹp phạm vi một nẻo thì hoặc lọt dữ liệu, hoặc ra bảng trống không
  // báo gì.
  if (!can(actor, "staff", "view-detail")) return forbidden();

  const url = new URL(request.url);
  const params = url.searchParams;
  const summaryMonth = params.get("summaryMonth") ?? "";
  if (summaryMonth && !isYearMonth(summaryMonth)) return badRequest("Tháng không hợp lệ");

  const query: Omit<StaffQuery, "page" | "sort" | "dir"> = {
    scope: params.get("scope") ?? "",
    // Chuỗi không phải uuid đi thẳng vào SQL là `22P02` → 500. Link cũ trỏ
    // phòng đã xoá không đáng làm hỏng cả màn: bỏ qua bộ lọc, hiện tất cả.
    departmentId: uuidParam(params.get("departmentId")),
    search: params.get("search") ?? "",
    summaryMonth,
    status: (params.get("status") ?? "active") as StaffQuery["status"],
    // Lọc qua danh sách vai có thật, cùng lối nghĩ với danh sách trắng khoá
    // sắp: vai lạ đi vào `inArray` trên cột enum là 500, mà URL có ô lọc chức
    // vụ thì người ta chia sẻ link cho nhau.
    roles: (params.get("roles") ?? "")
      .split(",")
      .filter((r): r is RoleKey => RoleKey.options.includes(r as RoleKey)),
  };

  return Response.json(
    await staffFor(actor, query, pageArgsFrom(url, STAFF_SORT, "name")),
  );
}

export async function POST(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();
  if (!can(actor, "staff", "create")) return forbidden();

  // Máy chủ tự kiểm dữ liệu vào — không tin client đã chạy zod. `actorId`
  // client gửi kèm (di sản cũ) rơi rụng luôn ở bước parse vì không có trong schema.
  const parsed = StaffForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  // Không tạo người vào phòng mình không quản: trần vai và trần quyền vẫn giữ
  // được, nhưng thiếu dòng này thì trục phạm vi thủng.
  if (!inVisibleScope(actor, "staff", "create", parsed.data.departmentId || null))
    return forbidden();

  const result = await createStaff(actor, parsed.data);
  if (!result.ok) return Response.json(saveError(result.code), { status: 422 });

  await logAudit(actor, {
    module: "staff",
    action: "create",
    targetLabel: `Nhân viên ${result.staff.fullName}`,
    targetTable: "users",
    targetId: result.staff.id,
  });
  return Response.json(result.staff, { status: 201 });
}
