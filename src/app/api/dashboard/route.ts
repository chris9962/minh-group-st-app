import { badRequest, forbidden, getActor, unauthorized } from "@/server/auth";
import { dashboardFor, dashboardVisibility, draftAccountsFor } from "@/server/dashboard";
import { businessDay } from "@/lib/format";
import { periodRanges, toPersonPeriod } from "@/lib/period";
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
     * `last-3-months` · `range:từ:đến`, còn `personFor` dùng `today` ·
     * `YYYY-MM` · `range:từ:đến`. Truyền thẳng `this-month` sang là Postgres
     * nhận `this-month-01` rồi đổ lỗi cast ngày — 500 cho mọi nhân viên.
     */
    const today = businessDay();
    const personPeriod = toPersonPeriod(period, today);
    if (!isPeriod(personPeriod)) return badRequest("Kỳ xem không hợp lệ");

    const [person, draftAccounts] = await Promise.all([
      personFor(actor, actor.id, {
        period: personPeriod,
        // Vòng điểm và lương theo THÁNG chứa kỳ đang xem, như hồ sơ P-52 (chốt
        // 2026-10-19). Xem theo ngày vẫn ra cả tháng của ngày đó: chỉ tiêu là
        // con số của cả tháng, so với một ngày thì vòng gần như trống.
        summaryMonth: periodRanges(period, today).current.from.slice(0, 7),
      }),
      draftAccountsFor(actor.id),
    ]);
    // `null` nghĩa là chính tài khoản đang đăng nhập không đọc nổi hồ sơ của
    // mình — không xảy ra trong thực tế, nhưng trả 403 vẫn hơn là 500.
    return person ? Response.json({ kind: "personal", person, draftAccounts }) : forbidden();
  }

  const { data, scopeLabel } = await dashboardFor(actor, period);
  return Response.json({ kind: "overview", scopeLabel, data });
}
