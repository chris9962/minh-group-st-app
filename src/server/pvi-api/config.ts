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

/** `test` là `piastest`, `prod` là máy chủ chạy thật của PVI. */
export type PviApiEnv = "test" | "prod";

/**
 * Gốc đường dẫn API theo môi trường, tới hết `ManagerApplication`.
 *
 * Hai môi trường KHÔNG chỉ khác tên miền: bản test có thêm đoạn `/API_CP`, bản
 * thật thì không, và bản thật đi `https`. PVI báo 2026-09-10. Vì vậy không ghép
 * được từ một gốc URL cộng một đường dẫn chung; mỗi môi trường một chuỗi trọn.
 */
export const PVI_ENDPOINT_PREFIX: Record<PviApiEnv, string> = {
  test: "http://piastest.pvi.com.vn/API_CP/ManagerApplication",
  prod: "https://apiwebview.pvi.com.vn/ManagerApplication",
};

/** Đường dẫn cố định của proxy chạy thử trên mgst-app, không đổi theo môi trường. */
export const PVI_PROXY_PATH = "/API_CP/ManagerApplication";

export type PviApiConfig = {
  env: PviApiEnv;
  /**
   * Gốc URL của máy chủ đứng giữa, ví dụ `https://app.mgst.com.vn`. CHỈ đặt
   * trên máy cá nhân: PVI chặn theo IP nên máy cá nhân phải gọi nhờ máy chủ.
   * Rỗng thì gọi thẳng PVI theo `env`.
   */
  proxyOrigin: string;
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
 * Môi trường PVI đang trỏ tới. Thiếu biến thì là `test`: quên đặt biến trên
 * một máy thử không được thành hợp đồng thật.
 */
export function readPviApiEnv(): PviApiEnv {
  return (process.env.PVI_API_ENV ?? "").trim() === "prod" ? "prod" : "test";
}

/** URL đầy đủ của một mục API, ví dụ `pviEndpointUrl("prod", "TaoDon_XeMay")`. */
export const pviEndpointUrl = (env: PviApiEnv, endpoint: string): string =>
  `${PVI_ENDPOINT_PREFIX[env]}/${endpoint}`;

/**
 * Đọc cấu hình mỗi lần gọi, KHÔNG cache ở tầng module — giống `storage.ts`.
 *
 * Cache thì lần khởi động đầu thiếu biến sẽ khoá cứng trạng thái "chưa cấu
 * hình" cho tới khi khởi động lại tiến trình.
 */
export function readPviApiConfig(): PviApiConfig | null {
  const cpId = (process.env.PVI_API_CPID ?? "").trim();
  const key = (process.env.PVI_API_KEY ?? "").trim();
  if (!cpId || !key) return null;

  const timeout = Number(process.env.PVI_API_TIMEOUT_MS);

  return {
    env: readPviApiEnv(),
    proxyOrigin: (process.env.PVI_API_PROXY_ORIGIN ?? "").trim().replace(/\/+$/, ""),
    cpId,
    key,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    signUppercase: process.env.PVI_API_SIGN_UPPERCASE === "1",
  };
}

/** `true` khi đã điền đủ hai biến bắt buộc — màn hình quản trị dùng để hiện trạng thái. */
export const pviApiConfigured = (): boolean => readPviApiConfig() !== null;
