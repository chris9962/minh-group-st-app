import { z } from 'zod';
import { toWebpImage } from '../toWebpImage';

/**
 * Tải ảnh lên kho lưu trữ — BƯỚC RIÊNG, không đụng database.
 *
 * Luồng có hai nhịp, cố ý tách rời:
 *
 *   1. `uploadImage(file)` → máy chủ đẩy lên S3 → trả về URL
 *   2. nơi gọi cầm URL đó gửi vào endpoint nghiệp vụ để ghi database
 *
 * Vì sao không gộp một nhịp: tải ảnh chậm và hay hỏng giữa chừng (mạng 3G
 * ngoài trời), còn ghi database thì nhanh và phải nguyên tử. Gộp lại thì một
 * lần rớt mạng lúc tải ảnh thứ tư kéo theo cả bản ghi, và người dùng phải điền
 * lại từ đầu. Tách ra thì ảnh nào lên được là xong ảnh đó.
 *
 * Vì sao đẩy qua MÁY CHỦ chứ không cho trình duyệt bắn thẳng lên S3: khoá S3
 * không bao giờ rời khỏi máy chủ, và mọi thứ đi lên đều qua được chốt kiểm loại
 * file với dung lượng.
 */

export const UploadResult = z.object({ url: z.string() });
export type UploadResult = z.infer<typeof UploadResult>;

/** Trần dung lượng một ảnh — kiểm ở CẢ hai đầu, máy chủ mới là chốt thật. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * Chặn sớm ở trình duyệt cho người dùng biết ngay, KHÔNG phải để tin tưởng.
 * Máy chủ kiểm lại từ đầu và không đọc `file.type` client khai.
 */
export function imageProblem(file: File): string | null {
  if (file.size > MAX_IMAGE_BYTES)
    return `Ảnh "${file.name}" nặng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt mức 10MB.`;
  if (file.type && !ACCEPTED_IMAGE_TYPES.includes(file.type))
    return `"${file.name}" không phải ảnh. Chỉ nhận JPG, PNG, WEBP hoặc HEIC.`;
  return null;
}

/**
 * Ảnh chuyển sang WebP ngay trước khi gửi (spec §U7).
 *
 * Đặt ở đây chứ không ở nơi chọn ảnh: mọi đường tải ảnh đều đi qua hàm này, nên
 * một chỗ là đủ. Ảnh xem trước vẫn dựng từ file gốc — người dùng thấy ảnh ngay
 * lúc chọn, không phải đợi chuyển xong.
 *
 * ⚠️ Trần 10MB của `imageProblem` vẫn đo trên file GỐC. Ảnh 12MB bị từ chối lúc
 * chọn dù chuyển xong chỉ còn vài trăm KB — đổi thứ tự đó là việc riêng, chưa làm.
 */
/**
 * Nhóm ảnh — quyết thư mục trong kho. Máy chủ có danh sách trắng riêng và tự
 * hạ về `bank-accounts` khi nhận giá trị lạ.
 */
export type UploadFolder = 'bank-accounts' | 'referral-codes' | 'bank-guides';

export async function uploadImage(
  file: File,
  folder: UploadFolder = 'bank-accounts',
): Promise<string> {
  const body = new FormData();
  body.append('file', await toWebpImage(file));
  body.append('folder', folder);

  const res = await fetch('/api/uploads', { method: 'POST', body });
  if (!res.ok) {
    // Máy chủ nói rõ vì sao — thiếu cấu hình kho lưu trữ, file quá nặng, sai
    // định dạng. Nuốt đi rồi ném câu chung chung là bắt người dùng đoán.
    const detail = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message?.trim() || `Không tải được ảnh "${file.name}"`);
  }
  return UploadResult.parse(await res.json()).url;
}
