import { create } from 'zustand';

/**
 * Ngăn xếp các `<dialog>` đang mở.
 *
 * `showModal()` đẩy phần tử vào TOP LAYER của trình duyệt — một tầng vẽ nằm
 * ngoài cây xếp chồng thông thường, đứng trên mọi DOM thường bất kể `z-index`.
 * Nghĩa là tấm toast render ở gốc app sẽ bị hộp thoại che, và không con số
 * `z-index` nào cứu được: hai thứ đó không so với nhau.
 *
 * Cách duy nhất để nổi lên trên là cũng ở trong top layer — tức portal vào
 * chính `<dialog>` đang mở. `Dialog` tự khai báo vào đây để `ToastHost` biết
 * đích portal. Phải là store chứ không phải context: `Dialog` là CON của
 * `ToastHost` trong cây React, context chảy từ cha xuống con nên sai chiều.
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
  push: (el) =>
    set((s) => (s.stack.includes(el) ? s : { stack: [...s.stack, el] })),
  pop: (el) => set((s) => ({ stack: s.stack.filter((d) => d !== el) })),
}));

/** `<dialog>` trên cùng, hoặc null khi không có cái nào mở. */
export const topDialog = (stack: HTMLDialogElement[]): HTMLDialogElement | null =>
  stack.length > 0 ? stack[stack.length - 1] : null;
