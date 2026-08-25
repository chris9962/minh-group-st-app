import type { FieldErrors } from "react-hook-form";
import { toast } from "./toast";

/**
 * Xử lý lượt submit hỏng vì form chưa hợp lệ — truyền vào tham số thứ hai của
 * `handleSubmit`.
 *
 * Lỗi từng ô vẫn hiện dưới đúng ô đó như cũ. Chỗ thiếu là người dùng không
 * THẤY: nút bấm nằm ở `footer` của `Dialog`, thân form cuộn riêng, nên ô sai
 * thường nằm ngoài vùng nhìn và màn hình không đổi gì sau khi bấm.
 *
 * Cố ý KHÔNG làm mờ nút bấm thay cho cách này: nút mờ không nói được thiếu ô
 * nào, mà form tạo đơn bảo hiểm có hơn 20 ô và có ô bắt buộc theo điều kiện.
 *
 * Toast ở đây báo KẾT QUẢ lượt bấm ("không gửi được"), không thay cho lỗi từng
 * ô — nó chỉ đếm số ô và gọi tên ô đầu tiên.
 *
 * Mọi form tắt `shouldFocusError` của react-hook-form để nhường cho hàm này.
 * Cơ chế đó duyệt theo danh sách ô ĐÃ REGISTER, nên ô nào dùng `setValue`
 * (`Select`, `DateField`) bị bỏ qua: sửa xong biển số xe là nó nhảy thẳng
 * xuống người thụ hưởng, không dừng ở "Loại xe". Dò `aria-invalid` trên DOM
 * thì đúng thứ tự trên xuống, kể cả ô không register.
 */
export function reportInvalid(errors: FieldErrors, event?: React.BaseSyntheticEvent) {
  const messages = leafMessages(errors);
  const form = event?.target instanceof HTMLElement ? event.target : null;

  findInvalidField(form, (field) => {
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: "center" });
    toast.fail(invalidMessage(messages, labelOf(form, field)));
  });
}

/**
 * Dò ô sai đầu tiên, thử lại vài khung hình.
 *
 * `handleSubmit` gọi hàm này TRƯỚC khi đẩy lỗi sang React (xem `_subjects.state.next`
 * ở cuối `handleSubmit` của react-hook-form), nên khung hình đầu tiên có thể
 * chưa có `aria-invalid` nào. Một lượt `requestAnimationFrame` là đủ trong phần
 * lớn ca, nhưng không phải mọi ca — máy bận thì lượt vẽ của React rơi sau.
 */
function findInvalidField(form: HTMLElement | null, done: (field: HTMLElement | null) => void) {
  let left = 5;
  const look = () => {
    const field = form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? null;
    if (field || --left <= 0) return done(field);
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/** Câu lỗi của từng ô, giữ thứ tự khai trong schema. */
function leafMessages(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const message = (node as { message?: unknown }).message;
  if (typeof message === "string") return [message];
  return Object.values(node as Record<string, unknown>).flatMap(leafMessages);
}

function labelOf(form: HTMLElement | null, field: HTMLElement | null): string {
  if (!form || !field?.id) return "";
  // `useId` sinh id chứa ký tự lạ nên phải escape mới query được.
  const label = form.querySelector(`label[for="${CSS.escape(field.id)}"]`);
  // Nhãn còn chứa dấu * và phần dán thêm (bộ đếm ký tự) — chỉ lấy đoạn chữ đầu.
  return label?.firstChild?.textContent?.trim() ?? "";
}

/**
 * Không tìm ra ô nào tô đỏ thì ĐỌC THẲNG câu lỗi của schema.
 *
 * Có ô hỏng mà không có giao diện — `customerId` của biểu mẫu mở tài khoản
 * chẳng hạn, nó do hộp thoại trước truyền vào. Bảo người dùng "xem dòng chữ đỏ
 * dưới từng ô" lúc đó là chỉ vào chỗ không có gì.
 */
function invalidMessage(messages: string[], label: string): string {
  const count = messages.length;
  if (label)
    return count === 1
      ? `Chưa điền đúng ô “${label}”.`
      : `Còn ${count} ô chưa hợp lệ, bắt đầu từ ô “${label}”.`;

  const first = messages[0] ?? "Biểu mẫu chưa hợp lệ";
  return count <= 1 ? `${first}.` : `Còn ${count} ô chưa hợp lệ: ${first}.`;
}
