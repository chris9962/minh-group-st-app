import { CUSTOMER_ERROR, CustomerForm, type CustomerSort } from "@/lib/api/customers";
import { logAudit } from "@/server/audit";
import { actorWith, badRequest, jsonBody, signedIn, uuidParam } from "@/server/auth";
import { createCustomer, listCustomers } from "@/server/customers";
import { pageArgsFrom } from "@/server/pagination";

const SORTABLE: readonly CustomerSort[] = ["name", "accounts", "insurance", "created"];

/**
 * P-40 · Danh sách khách hàng.
 *
 * Chỉ chặn ở mức đã đăng nhập: hồ sơ khách không áp trục phạm vi (spec §2.1b),
 * và sidebar cũng hiện mục này cho mọi người — hai nơi phải khớp, lệch nhau thì
 * menu dẫn tới một màn bị chính nó chặn.
 */
export async function GET(request: Request) {
  const guard = await signedIn(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const params = url.searchParams;

  return Response.json(
    await listCustomers(
      {
        search: params.get("search") ?? "",
        channelId: uuidParam(params.get("channelId")),
        from: params.get("from") ?? "",
        to: params.get("to") ?? "",
        /**
         * Nhân viên chỉ thấy khách MÌNH tạo — CHỈ khi nơi gọi hỏi bằng `mine=1`.
         *
         * Bộ lọc này là một CÁCH XEM của bảng P-40 (chốt 2026-08-15), không
         * phải phân quyền: spec §2.1b bắt buộc mọi nhân viên xem được mọi hồ sơ
         * khách, và §2.1b có hẳn mục "Đây không phải tuỳ chọn" nêu lý do.
         *
         * Bản trước đặt điều kiện thẳng ở route nên nó áp cho MỌI nơi gọi. Ba ô
         * tìm khách của hộp thoại Mở tài khoản, Tạo đơn bảo hiểm và Ghi dịch vụ
         * dùng chung route này, nên nhân viên không tìm ra khách của đồng nghiệp
         * và không mở nổi tài khoản cho họ. Chính commit `dd2a480` viết là chỉ
         * áp cho P-40 — code không làm đúng câu đó.
         */
        /**
         * `mine=1` thắng `staffId`: bảng P-40 luôn gửi cờ này, còn ô lọc Nhân
         * viên chỉ hiện với người có `staff:view-detail` — nhân viên không có
         * quyền đó nên hai tham số không bao giờ chọi nhau ở giao diện. Ưu tiên
         * tường minh ở đây để lời gọi nặn tay cũng ra một kết quả xác định.
         */
        createdBy:
          params.get("mine") === "1" && guard.actor.role === "staff"
            ? guard.actor.id
            : uuidParam(params.get("staffId")),
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
    // Không có hồ sơ trùng để chỉ ra thì khoá duy nhất bị đụng là số điện thoại
    // chính — nói "CCCD trùng" lúc đó là chỉ sai chỗ.
    if (!result.existing) return badRequest("Không lưu được hồ sơ khách này");
    return Response.json(
      {
        code: CUSTOMER_ERROR.DUPLICATE_ID,
        message: "CCCD này đã có hồ sơ trong hệ thống",
        existing: result.existing,
      },
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
