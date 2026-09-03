import { CUSTOMER_ERROR, CustomerForm, type CustomerSort } from "@/lib/api/customers";
import { logAudit } from "@/server/audit";
import { recordVisibility } from "@/lib/permissions";
import type { User } from "@/lib/types";
import { actorWith, badRequest, jsonBody, signedIn, uuidParam } from "@/server/auth";
import { createCustomer, listCustomers } from "@/server/customers";
import { pageArgsFrom } from "@/server/pagination";

const SORTABLE: readonly CustomerSort[] = ["name", "accounts", "insurance", "created"];

/**
 * Bộ lọc phạm vi của BẢNG P-40, tính theo QUYỀN chứ không theo chức vụ.
 *
 * Đọc quyền chứ không đọc `role`: chức vụ chỉ là bộ quyền mặc định lúc tạo hồ
 * sơ (AGENTS.md §6). Một trưởng phòng được cấp `view-detail` toàn công ty thì
 * vẫn thấy hết, và cấp đó là quyết định của người quản trị.
 *
 * Bốn mức đều phải có nhánh riêng. `none` và `creator` mà rơi về `undefined` là
 * "không lọc gì" — người đáng hẹp nhất lại thấy trọn kho.
 */
function p40Scope(actor: User): { departmentIds?: string[]; createdBy?: string } {
  const view = recordVisibility(actor, "customer", "view-detail");
  switch (view.kind) {
    case "all":
      return {};
    case "departments":
      return { departmentIds: view.departmentIds };
    case "creator":
      return { createdBy: view.userId };
    // Phạm vi `phòng tôi quản` mà chưa được giao phòng nào — ca có thật, hai
    // Phó GĐ đang ở tình trạng đó. Mảng rỗng cho ra `where false`, đúng nghĩa
    // "không phòng nào".
    case "none":
      return { departmentIds: [] };
  }
}

/**
 * P-40 · Danh sách khách hàng.
 *
 * Chỉ chặn ở mức đã đăng nhập, và sidebar cũng hiện mục này cho mọi người — hai
 * nơi phải khớp, lệch nhau thì menu dẫn tới một màn bị chính nó chặn. Số DÒNG
 * thì áp phạm vi, và áp KHÔNG ĐIỀU KIỆN (chốt 2026-08-23).
 *
 * Bản trước nhận tham số `mine=1` và chỉ áp phạm vi khi có nó, vì ô tìm khách
 * của ba hộp thoại dùng chung route này. Bỏ tham số đó khỏi URL là đọc được cả
 * kho — cờ do phía gọi gửi không phải phân quyền (AGENTS.md §6). Ô tìm khách
 * nay đi `/api/customers/lookup`.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const params = url.searchParams;
  const scope = p40Scope(guard.actor);

  return Response.json(
    await listCustomers(
      {
        search: params.get("search") ?? "",
        channelId: uuidParam(params.get("channelId")),
        channelDetail: params.get("channelDetail") ?? "",
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        /**
         * Phạm vi thắng bộ lọc do người dùng chọn.
         *
         * Ô lọc Nhân viên chỉ hiện với người có `staff:view-detail`, nhưng người
         * mang phạm vi `chỉ mình` không được mượn tham số đó để xem bảng của
         * người khác — lời gọi nặn tay cũng phải ra một kết quả xác định.
         */
        createdBy: scope.createdBy ?? uuidParam(params.get("staffId")),
        departmentIds: scope.departmentIds,
        departmentId: uuidParam(params.get("departmentId")),
      },
      pageArgsFrom(url, SORTABLE, "created"),
    ),
  );
}

/** P-41 · Tạo hồ sơ khách. */
export async function POST(request: Request) {
  const guard = await actorWith(request, "customer", "create");
  if (!guard.ok) return guard.response;

  const parsed = CustomerForm.safeParse(await jsonBody(request));
  if (!parsed.success) return badRequest();

  const result = await createCustomer(guard.actor, parsed.data);
  if (!result.ok) {
    // Câu báo bám theo TÊN CHỈ MỤC bị đụng, không suy từ việc tra được hồ sơ
    // hay không. Khoá duy nhất khác `customers_id_number` là ràng buộc nội bộ,
    // nói "CCCD trùng" lúc đó là chỉ sai chỗ.
    if (result.reason !== "duplicate-id-number")
      return badRequest("Không lưu được hồ sơ khách này");
    return Response.json(
      { code: CUSTOMER_ERROR.DUPLICATE_ID, message: "CCCD này đã có hồ sơ trong hệ thống" },
      { status: 422 },
    );
  }

  await logAudit(guard.actor, {
    module: "customer",
    action: "create",
    targetLabel: `Thêm khách hàng ${result.customer.fullName}`,
    targetTable: "customers",
    targetId: result.customer.id,
  });
  return Response.json(result.customer, { status: 201 });
}
