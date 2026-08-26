/**
 * Cấu hình kết nối API đối tác của PVI.
 *
 * KHÁC HẲN `pvi-qlcd-playwright/`: bot đó điều khiển trình duyệt trên
 * https://qlcd.pvi.com.vn bằng tài khoản người dùng. Module này gọi API chính
 * thức bằng cặp `CpId` + `Key` PVI cấp cho đối tác. Hai đường độc lập, giữ
 * riêng để bỏ được một đường mà không đụng đường kia.
 *
 * Nguồn: `API_Tham khao.docx` v1.0 (11/02/2026), mục 10 và mục 11.
 */

export type PviApiConfig = {
  /** Gốc URL, không có dấu `/` cuối. Bản test: `http://piastest.pvi.com.vn`. */
  baseUrl: string;
  cpId: string;
  /** Khoá bí mật để ký MD5. KHÔNG bao giờ ghi ra log. */
  key: string;
  timeoutMs: number;
  /**
   * PVI so chữ ký chữ HOA hay chữ thường — tài liệu không nói.
   *
   * Sai hoa/thường là hỏng mọi lệnh gọi với mã `-105 Sai chữ ký`, mà không có
   * cách nào đoán trước. Để cờ này thử được cả hai trong một lần chạy thay vì
   * hai lần sửa code.
   */
  signUppercase: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Đọc cấu hình mỗi lần gọi, KHÔNG cache ở tầng module — giống `storage.ts`.
 *
 * Cache thì lần khởi động đầu thiếu biến sẽ khoá cứng trạng thái "chưa cấu
 * hình" cho tới khi khởi động lại tiến trình.
 */
export function readPviApiConfig(): PviApiConfig | null {
  const baseUrl = (process.env.PVI_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const cpId = (process.env.PVI_API_CPID ?? "").trim();
  const key = (process.env.PVI_API_KEY ?? "").trim();
  if (!baseUrl || !cpId || !key) return null;

  const timeout = Number(process.env.PVI_API_TIMEOUT_MS);

  return {
    baseUrl,
    cpId,
    key,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    signUppercase: process.env.PVI_API_SIGN_UPPERCASE === "1",
  };
}

/** `true` khi đã điền đủ ba biến bắt buộc — màn hình quản trị dùng để hiện trạng thái. */
export const pviApiConfigured = (): boolean => readPviApiConfig() !== null;
