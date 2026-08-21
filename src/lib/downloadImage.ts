import { searchKey } from "@/lib/format";
import { toast } from "@/lib/toast";

/**
 * `Ảnh chứng nhận bảo hiểm` → `anh-chung-nhan-bao-hiem.webp`.
 *
 * Đuôi lấy từ đường dẫn, không có thì suy từ kiểu của blob: ảnh CHƯA lưu mang
 * URL dạng `blob:` vốn không có phần mở rộng nào.
 */
function fileName(alt: string, src: string, mimeType: string): string {
  const fromPath = new URL(src, location.href).pathname.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  const ext = fromPath ?? mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "jpg";
  return `${searchKey(alt).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "anh"}.${ext}`;
}

/**
 * Lưu một tấm ảnh về máy người dùng.
 *
 * Tải qua `blob:` chứ không đặt `download` thẳng lên URL của ảnh: ảnh CHƯA lưu
 * mang URL `blob:` do chính trang dựng ra, còn ảnh đã lưu đi qua `/api/images`.
 * Tải về thành blob rồi mới lưu thì tên file và hành vi giống nhau ở cả hai ngả.
 */
export async function downloadImage(src: string, alt: string): Promise<void> {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(alt, src, blob.type);
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    toast.fail("Không tải được ảnh về máy. Bấm chuột phải vào ảnh rồi chọn lưu.");
  }
}
