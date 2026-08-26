import { createHash } from "node:crypto";
import { readPviApiConfig, type PviApiConfig } from "./config";

/**
 * Tầng vận chuyển dùng chung cho mọi API của PVI: ký MD5, gửi POST, đọc kết quả.
 *
 * Mọi API PVI cùng một khuôn — POST một chuỗi JSON, nhận về `Status` + `Message`
 * — nên phần khác nhau giữa các mục chỉ còn là danh sách trường và công thức
 * ký. Gom khuôn vào đây để thêm mục 9 hay mục 12 sau này chỉ phải viết đúng hai
 * thứ đó.
 */

/** Mã lỗi ở "Bảng mã lỗi" cuối tài liệu PVI, cộng `-504` mà mục 4 dùng. */
const ERROR_MESSAGES: Record<string, string> = {
  "-404": "Dữ liệu không hợp lệ",
  "-400": "Lỗi dữ liệu",
  "-105": "Sai chữ ký",
  "-504": "Đơn vi phạm, không được phép tạo đơn",
  "-1": "Lỗi exception phía PVI",
};

export type PviApiErrorKind =
  /** Chưa điền `PVI_API_*` trong `.env.local`. */
  | "config"
  /** Không nối được tới máy chủ PVI, hoặc quá hạn chờ. */
  | "network"
  /** PVI trả mã HTTP khác 2xx — thường là sai đường dẫn hoặc máy chủ hỏng. */
  | "http"
  /** PVI trả 200 nhưng thân phản hồi không phải JSON đúng khuôn. */
  | "malformed"
  /** PVI nhận được lệnh gọi và từ chối: `Status` khác `00`. */
  | "business";

export class PviApiError extends Error {
  readonly kind: PviApiErrorKind;
  /** Mã PVI trả về, chỉ có với `kind: "business"`. */
  readonly status?: string;
  readonly endpoint: string;

  constructor(opts: { kind: PviApiErrorKind; message: string; endpoint: string; status?: string }) {
    super(opts.message);
    this.name = "PviApiError";
    this.kind = opts.kind;
    this.endpoint = opts.endpoint;
    this.status = opts.status;
  }
}

/**
 * Chuẩn hoá một giá trị trước khi ký VÀ trước khi gửi.
 *
 * `.trim()` là bắt buộc, không phải dọn dẹp cho đẹp. Request mẫu trong tài liệu
 * PVI có `"ngay_cuoi": "23/12/2026 14:59 "` — dư một dấu cách cuối. Chữ ký nối
 * chuỗi rồi băm, nên một dấu cách thừa ra một MD5 khác hẳn và PVI trả `-105`.
 * Cắt ở đúng một chỗ này thì mọi trường đi qua đều sạch, người gọi không phải
 * nhớ.
 */
export const pviText = (value: string | null | undefined): string => (value ?? "").trim();

/**
 * Số → chuỗi để ký, khớp `.ToString()` của C# với số nguyên.
 *
 * Tài liệu ký `model.sotien_bh.ToString()`. Số tiền bảo hiểm và phí đều là số
 * nguyên đồng, nên `String(100000000)` = `"100000000"` trùng kết quả C#. Có
 * phần thập phân thì hai bên có thể ra chuỗi khác nhau (dấu phẩy theo culture),
 * nên schema chặn số lẻ từ đầu thay vì đoán ở đây.
 */
export const pviNumber = (value: number): string => String(value);

/**
 * Ký MD5 theo công thức của từng API.
 *
 * `Key` luôn đứng đầu, các phần còn lại nối theo ĐÚNG thứ tự tài liệu ghi. Thứ
 * tự sai thì MD5 sai, mà PVI chỉ trả `-105` chung chung nên không lần ngược
 * được — vì vậy nơi gọi truyền mảng theo đúng dòng công thức, không tự sắp lại.
 */
export function pviSign(config: PviApiConfig, parts: readonly string[]): string {
  const digest = pviSignHex(config, parts);
  return config.signUppercase ? digest.toUpperCase() : digest;
}

/**
 * Cùng phép băm nhưng LUÔN chữ thường, không đụng `signUppercase`.
 *
 * Dùng khi KIỂM chữ ký PVI gửi tới (mục 13 callback), ngược chiều với `pviSign`.
 * Cờ `signUppercase` chỉ nói mình gửi đi kiểu gì; chiều nhận về do PVI quyết,
 * nên nơi kiểm hạ cả hai vế về chữ thường rồi mới so.
 */
export function pviSignHex(config: PviApiConfig, parts: readonly string[]): string {
  return createHash("md5")
    .update(config.key + parts.join(""), "utf8")
    .digest("hex");
}

/** Kết quả thô mọi API tạo đơn trả về. */
export type PviOrderResult = {
  /** `"00"` là thành công. */
  status: string;
  message: string;
  /** Khoá bản ghi bên PVI — dùng để tra lại đơn khi cần hỗ trợ. */
  prKey: number | null;
};

/**
 * `Status` của PVI là chuỗi `"00"`, nhưng bộ tuần tự JSON bên họ có thể trả số
 * `0`. Nhận cả hai thay vì so chuỗi cứng: so cứng thì một đơn tạo THÀNH CÔNG bị
 * hiểu là hỏng, người vận hành đi tạo lại và khách có hai đơn.
 */
const isSuccess = (raw: string): boolean => raw !== "" && Number(raw) === 0;

/** Phản hồi thô đã kiểm `Status` — dùng cho API trả nhiều trường hơn tạo đơn. */
export type PviResponse = {
  status: string;
  message: string;
  /** Nguyên object PVI trả về, để nơi gọi tự đọc trường riêng của nó. */
  raw: Record<string, unknown>;
};

/**
 * Gửi một lệnh gọi tới PVI và trả về kết quả đã kiểm.
 *
 * ⚠️ KHÔNG tự gọi lại khi hỏng. Đây là tầng dùng chung cho cả API tạo đơn: PVI
 * nhận đơn xong mà phản hồi rớt giữa đường thì gọi lại có thể ra đơn thứ hai
 * cho cùng một khách. Việc gọi lại thuộc về nơi điều phối — chỗ đó biết
 * `ma_giaodich` cũ và tra được bằng `getPolicyNumber` trước khi quyết định.
 */
export async function pviRequest(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<PviResponse> {
  const config = readPviApiConfig();
  if (!config) {
    throw new PviApiError({
      kind: "config",
      endpoint,
      message: "Chưa cấu hình PVI_API_BASE_URL / PVI_API_CPID / PVI_API_KEY trong .env.local",
    });
  }

  const url = `${config.baseUrl}/API_CP/ManagerApplication/${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (cause) {
    // Không đưa `body` vào thông báo: nó chứa `Sign`, và log của Next đi vào
    // file mà nhiều người đọc được.
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new PviApiError({
      kind: "network",
      endpoint,
      message: `Không gọi được ${endpoint}: ${reason}`,
    });
  }

  const text = await response.text();

  if (!response.ok) {
    throw new PviApiError({
      kind: "http",
      endpoint,
      message: `${endpoint} trả HTTP ${response.status}: ${text.slice(0, 300)}`,
    });
  }

  const parsed = parseResult(text, endpoint);

  if (!isSuccess(parsed.status)) {
    const known = ERROR_MESSAGES[parsed.status];
    throw new PviApiError({
      kind: "business",
      endpoint,
      status: parsed.status,
      message: parsed.message || known || `PVI từ chối với mã ${parsed.status}`,
    });
  }

  return parsed;
}

/** Lệnh gọi tạo đơn — cùng đường với `pviRequest`, chỉ rút thêm `Pr_key`. */
export async function pviPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<PviOrderResult> {
  const { status, message, raw } = await pviRequest(endpoint, body);
  const prKey = Number(raw.Pr_key ?? raw.pr_key);
  return { status, message, prKey: Number.isFinite(prKey) && prKey > 0 ? prKey : null };
}

/**
 * Đọc thân phản hồi.
 *
 * PVI mô tả kết quả là "chuỗi json được tạo từ Object". Một số endpoint của họ
 * trả về JSON đã bị bọc thêm một lớp chuỗi, nên sau lần parse đầu mà vẫn còn là
 * chuỗi thì bóc thêm một lớp. Không bóc thì mọi phản hồi đều rơi vào
 * `malformed` dù đơn đã tạo xong.
 */
function parseResult(text: string, endpoint: string): PviResponse {
  let data: unknown;
  try {
    data = JSON.parse(text);
    if (typeof data === "string") data = JSON.parse(data);
  } catch {
    throw new PviApiError({
      kind: "malformed",
      endpoint,
      message: `${endpoint} trả về thân không phải JSON: ${text.slice(0, 300)}`,
    });
  }

  if (data === null || typeof data !== "object") {
    throw new PviApiError({
      kind: "malformed",
      endpoint,
      message: `${endpoint} trả về JSON không phải object: ${text.slice(0, 300)}`,
    });
  }

  const raw = data as Record<string, unknown>;
  const status = raw.Status ?? raw.status;
  if (status === undefined || status === null) {
    throw new PviApiError({
      kind: "malformed",
      endpoint,
      message: `${endpoint} trả về JSON thiếu trường Status: ${text.slice(0, 300)}`,
    });
  }

  return {
    status: String(status).trim(),
    message: String(raw.Message ?? raw.message ?? "").trim(),
    raw,
  };
}
