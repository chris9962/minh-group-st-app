import { create } from 'zustand';

/**
 * Ngăn xếp các `<dialog>` đang mở.
 *
 * `showModal()` đẩy phần tử vào TOP LAYER của trình duyệt. Đã ĐO bằng trình
 * duyệt thật: modal `<dialog>` luôn vẽ **trên** `popover`, bất kể mở cái nào
 * trước, và đóng rồi mở lại popover cũng không đảo được. Nên cách duy nhất để
 * toast nổi trên hộp thoại là nằm BÊN TRONG chính hộp thoại đó — cùng lối
 * `Combobox` đang dùng qua `DialogPortalContext`.
 *
 * `ToastHost` phải là store chứ không dùng được context: nó là CHA của
 * `Dialog` trong cây React, mà context chỉ chảy từ cha xuống con.
 *
 * Ngăn xếp chứ không phải một giá trị — hộp thoại lồng nhau có thật (sửa hồ sơ
 * nhân viên rồi bật hộp thoại xác nhận). Toast phải vào cái TRÊN CÙNG.
 */
type DialogLayer = {
  stack: HTMLDialogElement[];
  push: (el: HTMLDialogElement) => void;
  pop: (el: HTMLDialogElement) => void;
};

export const useDialogLayer = create<DialogLayer>((set) => ({
  stack: [],
  push: (el) => set((s) => (s.stack.includes(el) ? s : { stack: [...s.stack, el] })),
  pop: (el) => set((s) => ({ stack: s.stack.filter((d) => d !== el) })),
}));

/** `<dialog>` trên cùng, hoặc null khi không có cái nào mở. */
export const topDialog = (stack: HTMLDialogElement[]): HTMLDialogElement | null =>
  stack.length > 0 ? stack[stack.length - 1] : null;
