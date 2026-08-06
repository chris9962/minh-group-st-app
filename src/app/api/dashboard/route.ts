import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { dashboardFor, dashboardVisibility } from "@/server/dashboard";
import { businessMonth } from "@/lib/format";
import { isPeriod, personFor } from "@/server/people";

/**
 * P-80 · Tổng quan. Máy chủ quyết định người này thấy mặt nào của màn:
 *
 *   `company`     → số liệu toàn công ty
 *   `departments` → chỉ những phòng họ quản / phòng họ thuộc về
 *   `personal`    → hồ sơ chỉ số của CHÍNH họ, không phải của phòng
 *
 * Không nhận tham số `scope` từ client: phiên đăng nhập đã nói đủ, và một ô
 * phạm vi trên đường truyền chỉ là chỗ để nặn tay.
 */
export async function GET(request: Request) {
  const actor = await getActor(request);
  if (!actor) return unauthorized();

  const visible = dashboardVisibility(actor);
  // Không có `view-summary` ở module nghiệp vụ nào thì màn này không có gì để
  // hiện — mục "Tổng quan" trên điều hướng cũng đã ẩn theo đúng điều kiện đó.
  if (visible.kind === "none") return forbidden();

  const period = new URL(request.url).searchParams.get("period") ?? "today";

  if (visible.kind === "personal") {
    /**
     * Đúng hồ sơ P-52 mà cấp trên nhìn thấy, chỉ khác là tự xem — nên dùng lại
     * `personFor` thay vì dựng một bộ số liệu song song. Hai bộ số cho cùng
     * một con người là hai bộ sớm muộn lệch nhau.
     *
     * Luôn truyền `actor.id`: không có đường nào để xem hồ sơ người khác qua
     * endpoint này.
     */
    /**
     * Dịch từ vựng kỳ của `PeriodPicker` sang từ vựng của hồ sơ nhân viên.
     *
     * Hai màn nói hai thứ tiếng: `PeriodPicker` dùng `today` · `this-month` ·
     * `range:từ:đến`, còn `personFor` dùng `today` · `YYYY-MM` · `range:từ:đến`.
     * Chỉ lệch đúng một từ, và truyền thẳng `this-month` sang là Postgres nhận
     * `this-month-01` rồi đổ lỗi cast ngày — 500 cho mọi nhân viên.
     */
    const personPeriod = period === "this-month" ? businessMonth() : period;
    if (!isPeriod(personPeriod)) return badRequest("Kỳ xem không hợp lệ");

    const person = await personFor(actor, actor.id, {
      period: personPeriod,
      // Vòng điểm LUÔN theo tháng hiện tại, kể cả khi đang xem theo ngày: chỉ
      // tiêu là con số của cả tháng, đem so với một ngày ra một vòng gần như
      // trống và người đọc tưởng mình đang tụt.
      summaryMonth: businessMonth(),
    });
    // `null` nghĩa là chính tài khoản đang đăng nhập không đọc nổi hồ sơ của
    // mình — không xảy ra trong thực tế, nhưng trả 403 vẫn hơn là 500.
    return person ? Response.json({ kind: "personal", person }) : forbidden();
  }

  const { data, scopeLabel } = await dashboardFor(actor, period);
  return Response.json({ kind: "overview", scopeLabel, data });
}
