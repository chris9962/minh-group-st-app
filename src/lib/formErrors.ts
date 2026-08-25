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
  const count = countInvalid(errors);
  const form = event?.target instanceof HTMLElement ? event.target : null;

  // Đợi React vẽ xong `aria-invalid` rồi mới dò DOM — `handleSubmit` chạy bất
  // đồng bộ nên lúc gọi vào đây trạng thái lỗi chưa lên màn hình.
  requestAnimationFrame(() => {
    const field = form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? null;
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: "center" });
    toast.fail(invalidMessage(count, labelOf(form, field)));
  });
}

/** Đếm cả lỗi lồng trong mảng leg — `legs.2.fee` cũng tính là một ô. */
function countInvalid(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  if (typeof (node as { message?: unknown }).message === "string") return 1;
  return Object.values(node as Record<string, unknown>).reduce<number>(
    (total, child) => total + countInvalid(child),
    0,
  );
}

function labelOf(form: HTMLElement | null, field: HTMLElement | null): string {
  if (!form || !field?.id) return "";
  // `useId` sinh id chứa dấu hai chấm nên phải escape mới query được.
  const label = form.querySelector(`label[for="${CSS.escape(field.id)}"]`);
  // Nhãn còn chứa dấu * và phần dán thêm (bộ đếm ký tự) — chỉ lấy đoạn chữ đầu.
  return label?.firstChild?.textContent?.trim() ?? "";
}

function invalidMessage(count: number, label: string): string {
  if (!label) return `Còn ${count} ô chưa hợp lệ — xem dòng chữ đỏ dưới từng ô.`;
  if (count === 1) return `Chưa điền đúng ô “${label}”.`;
  return `Còn ${count} ô chưa hợp lệ, bắt đầu từ ô “${label}”.`;
}
