import { readPviApiConfig } from "./config";
import { PviApiError, pviRequest, pviSign } from "./client";

/**
 * Mục 3 · `Get_DanhMuc` — đọc một danh mục của PVI.
 *
 * Chỉ đọc, không có `ma_giaodich`, gọi bao nhiêu lần cũng không để lại gì bên
 * PVI. Ký bằng đúng `pviSign` như hai API tạo đơn, nên một lệnh gọi kiểm được
 * cả key, CpId, chữ ký hoa/thường, whitelist IP và đường mạng.
 */

/** Tài liệu mục 3 ghi `ma_donvi` cố định: `fix=34`. */
const PVI_MA_DONVI = "34";
/** Tài liệu chú thích `ma_user //để trống empty`. */
const PVI_MA_USER = "";

export async function getCatalog(name: string): Promise<unknown[]> {
  const config = readPviApiConfig();
  if (!config) {
    throw new PviApiError({
      kind: "config",
      endpoint: "Get_DanhMuc",
      message: "Chưa cấu hình PVI_API_CPID / PVI_API_KEY trong .env.local",
    });
  }

  const { raw } = await pviRequest("Get_DanhMuc", {
    parent_value: "",
    ten_dmuc: name,
    ma_user: PVI_MA_USER,
    ma_donvi: PVI_MA_DONVI,
    giatri_chon: "",
    CpId: config.cpId,
    // Thứ tự lấy nguyên văn ô `Tham số` của mục 3.
    Sign: pviSign(config, [name, PVI_MA_USER, PVI_MA_DONVI, ""]),
  });
  return Array.isArray(raw.Data) ? raw.Data : [];
}

export type PviAccessCheck =
  | { ok: true }
  /** `fatal`: sai cấu hình, chạy tiếp là mọi đơn đều hỏng. Không `fatal`: lỗi mạng, thử lại được. */
  | { ok: false; fatal: boolean; message: string };

/**
 * Kiểm cấu hình và kết nối PVI bằng một lệnh `Get_DanhMuc` (chốt 2026-09-07).
 *
 * Worker chạy với chữ ký sai thì từng đơn một trả `-105` và bị đẩy sang làm
 * tay, hết đơn này tới đơn khác. Kiểm một lần lúc khởi động và lúc deploy thì
 * lỗi nằm ở log khởi động, không nằm rải trên từng đơn.
 *
 * `-1` cũng tính là sai cấu hình: đo 2026-09-07, `CpId` không tồn tại thì PVI
 * trả `-1 NullReferenceException`, không trả `-105`.
 */
export async function checkPviAccess(): Promise<PviAccessCheck> {
  try {
    await getCatalog("LOAIXEMOTOR");
    return { ok: true };
  } catch (e) {
    if (!(e instanceof PviApiError)) return { ok: false, fatal: true, message: String(e) };
    const fatal = e.kind === "config" || e.status === "-105" || e.status === "-1";
    return {
      ok: false,
      fatal,
      message: `${e.kind}${e.status ? ` ${e.status}` : ""} - ${e.message}`,
    };
  }
}
