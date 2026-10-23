/**
 * Gọi API của PVI Connect (baohiem.pvi.com.vn) không qua trình duyệt.
 *
 * Chép từ skill `pvi-connect`, file `scripts/gom-don-huy.js`, ngày 2026-10-23.
 * Body của từng lệnh lấy từ request thật mà trang gửi; ghi chép đầy đủ ở
 * `~/.claude/skills/pvi-connect/references/huy-don.md`.
 */

const API = "https://api-baohiem.pvi.com.vn/policy";
const WEB = "https://baohiem.pvi.com.vn";

/** PVI trả JSON nhiều tầng, tên trường viết tắt tiếng Việt; khai đủ kiểu cho từng tầng không đáng. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PviJson = any;

export type PviUser = {
  ma_user: string;
  full_name: string;
  ma_donvi: string;
  ma_phong: string;
  ma_tthai: string;
};

export type PviSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | number | null;
  user: PviUser;
};

/** Một dòng trong danh sách chờ gom, đã rút gọn. `group` là mã nhóm PVI tự tính. */
export type MergeCandidate = {
  prKey: number;
  policyNumber: string;
  serial: string;
  unit: string;
  group: string;
  issuedOn: string;
};

export type MergeItem = { group: string; prKey: number; policyNumber: string; unit: string };

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

async function readJson(res: Response): Promise<PviJson | null> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const messageOf = (json: PviJson | null) => json?.message || json?.error?.message || json?.data?.message || "";

const dateOnly = (value: string | null | undefined) => (value || "").slice(0, 10);
const negate = (value: unknown) => -(Number(value) || 0);

/** PVI trả `expiresAt` khi dạng chuỗi ngày, khi dạng số. Không đọc được thì coi như đã hết hạn. */
export function expiresAtMs(value: PviSession["expiresAt"]) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const ms = value ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Đăng nhập bằng tài khoản và mật khẩu. Captcha có 6 ký tự chữ thường và số; `solveCaptcha`
 * đọc ảnh PNG và trả chuỗi đoán được.
 *
 * Sai captcha thì lấy captcha mới. Lỗi khác thì dừng ngay, để không thử mật khẩu nhiều lần.
 */
export async function login(
  username: string,
  password: string,
  solveCaptcha: (png: Buffer) => Promise<string>,
  maxAttempts = 8,
): Promise<PviSession> {
  let lastMessage = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const captchaRes = await fetch(`${API}/api/Captcha/generate`);
    const captcha = (await readJson(captchaRes))?.data;
    if (!captchaRes.ok || !captcha?.captcha_id) throw new Error(`Không lấy được captcha: HTTP ${captchaRes.status}`);

    const png = Buffer.from(String(captcha.captcha_image).replace(/^data:image\/\w+;base64,/, ""), "base64");
    const code = await solveCaptcha(png);
    if (code.length !== 6) {
      lastMessage = "không đọc được captcha";
      continue;
    }

    const res = await fetch(`${API}/api/Login/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: WEB, Referer: `${WEB}/` },
      body: JSON.stringify({ user_name: username, password, captcha_id: captcha.captcha_id, captcha_code: code }),
    });
    const json = await readJson(res);
    if (res.ok && json?.accessToken && json?.data?.isSuccess !== false) {
      return { accessToken: json.accessToken, refreshToken: json.refreshToken, expiresAt: json.expiresAt, user: json.data.dataUser };
    }

    lastMessage = messageOf(json) || `HTTP ${res.status}`;
    // Chưa thấy PVI trả chữ gì khi sai captcha. Chỉ thử lại khi thông báo nhắc tới captcha hoặc mã xác thực.
    if (!/captcha|mã xác|ma xac/i.test(lastMessage)) throw new Error(`Đăng nhập PVI không thành: ${lastMessage}`);
  }
  throw new Error(`Đăng nhập PVI không thành sau ${maxAttempts} lần: ${lastMessage}`);
}

/** Đổi refresh token lấy access token mới, như trang làm khi phiên sắp hết. Trả null nếu PVI từ chối. */
export async function refreshSession(session: PviSession): Promise<PviSession | null> {
  const res = await fetch(`${API}/api/Login/refresh-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: WEB, Referer: `${WEB}/` },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  const json = await readJson(res);
  if (!res.ok || !json?.accessToken) return null;
  return {
    ...session,
    accessToken: json.accessToken,
    refreshToken: json.refreshToken ?? session.refreshToken,
    expiresAt: json.expiresAt ?? null,
  };
}

export class PviClient {
  /** Trang tự sinh CSRF token ngẫu nhiên; phản hồi trả token mới thì trang dùng token mới. */
  private csrf = randomHex(32);

  constructor(readonly session: PviSession) {}

  get user() {
    return this.session.user;
  }

  private async call(method: "GET" | "POST", path: string, params?: Record<string, string>, body?: unknown) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.session.accessToken}`,
      Origin: WEB,
      Referer: `${WEB}/`,
    };
    if (method === "POST") Object.assign(headers, { "Content-Type": "application/json", "X-CSRF-Token": this.csrf });
    const query = params ? `?${new URLSearchParams(params)}` : "";
    const res = await fetch(API + path + query, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const nextCsrf = res.headers.get("x-csrf-token");
    if (nextCsrf) this.csrf = nextCsrf;
    const json = await readJson(res);
    if (!res.ok || json?.success === false) {
      const error = new Error(`${method} ${path}: HTTP ${res.status} ${messageOf(json)}`.trim());
      (error as Error & { status?: number }).status = res.status;
      throw error;
    }
    return json;
  }

  private async get(path: string, params?: Record<string, string>): Promise<PviJson> {
    return (await this.call("GET", path, params))?.data;
  }

  private post(path: string, body: unknown): Promise<PviJson> {
    return this.call("POST", path, undefined, body);
  }

  /** Lệnh nhẹ để biết phiên còn dùng được không. */
  async ping() {
    await this.get("/api/CtuXeCoGioi", { pageIndex: "1", pageSize: "1", maDonvi: this.user.ma_donvi, maCtus: "MOTO" });
  }

  /** Body trang Gom đơn gửi khi bấm "Tìm kiếm"; khoảng ngày chỉ là ngày `date`. */
  private searchBody(maCtu: string, product: string, date: string, extra: Record<string, unknown>) {
    return {
      pageIndex: 1,
      pageSize: 10,
      maCtu,
      maDonvi: this.user.ma_donvi,
      tuNgay: date,
      denNgay: date,
      soDon: "",
      maKhach: "",
      moiGioi: "",
      cbKhaiThac: "",
      soSeri: "",
      soImei: "",
      phongKhaiThac: this.user.ma_phong || "",
      bienKiemSoat: "",
      pThucKhaiThac: "",
      daiLy: "",
      duLieuGopDon: 1,
      sanPham: product,
      ...extra,
    };
  }

  private static toCandidate(row: PviJson): MergeCandidate {
    return {
      prKey: row.prKey,
      policyNumber: row.soDonbh,
      serial: String(row.soSeri),
      unit: row.maDonvi,
      group: row.idResponse,
      issuedOn: dateOnly(row.ngayCtu),
    };
  }

  /**
   * Seri xe máy chờ gom. `term` là ô "Thời hạn bảo hiểm": 1 là <= 12 tháng, 2 là 12-24 tháng,
   * 3 là trên 24 tháng. Trang bắt buộc chọn ô này, nên một seri phải thử lần lượt từng giá trị.
   */
  async searchMotorbikeCandidates(serial: string, term: number, date: string): Promise<MergeCandidate[]> {
    const json = await this.post("/api/ctugomdon/list-insurance", this.searchBody("MOTO", "050201", date, { soSeri: serial, thoiHanBaoHiem: term }));
    return (json?.data || []).map(PviClient.toCandidate).filter((c: MergeCandidate) => c.serial === serial);
  }

  /**
   * Mọi đơn điện chờ gom của ngày `date`. Trang Gom đơn tai nạn con người không lọc theo seri
   * hay số đơn: gửi `soSeri` thì PVI trả 422, `soDon` thì bị bỏ qua.
   */
  async listElectricCandidates(date: string): Promise<MergeCandidate[]> {
    const json = await this.post("/api/ctugomdon/list-insurance", this.searchBody("TNCG", "010206", date, {}));
    return (json?.data || []).map(PviClient.toCandidate);
  }

  /**
   * Như bấm "Tạo đơn" trên trang Gom đơn: mỗi nhóm một item, PVI tạo một đơn gom cho mỗi item.
   * Phản hồi chỉ có số đơn gom, không nói đơn lẻ nào vào đơn gom nào.
   */
  async createMergedOrders(maCtu: "MOTO" | "TNCG", product: string, items: MergeItem[]) {
    const groups = new Map<string, MergeItem[]>();
    for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
    const json = await this.post("/api/ctugomdon/themmoi", {
      maCtu,
      maSPGomDon: product,
      nguonGomDon: 1,
      mauser: this.user.ma_user,
      items: [...groups].map(([id, rows]) => ({
        id,
        lstDataGomDon: rows.map((r) => ({ prKey: r.prKey, soDonbh: r.policyNumber, maDonVi: r.unit })),
      })),
    });
    const numbers: string[] = json.lst_so_donbh ?? [];
    const prKeys: number[] = json.lst_pr_key ?? [];
    return numbers.map((number, i) => ({ number, prKey: prKeys[i] }));
  }

  /** Số đơn đang chứa seri xe máy, tra bằng "Tìm kiếm chung" theo ngày cấp trong năm `year`. */
  async findMotorbikePolicyNumbers(serial: string, year: string): Promise<string[]> {
    const data = await this.get("/api/CtuTraCuu", {
      pageIndex: "1",
      pageSize: "10",
      maSp: "050201",
      tuNgay: `${year}-01-01`,
      denNgay: `${year}-12-31`,
      soSeri: serial,
    });
    return [...new Set<string>((data?.items || []).map((i: PviJson) => i.soDonbh))];
  }

  /** Số seri của từng đơn lẻ trong một đơn gom điện. */
  async electricMergedSerials(prKey: number): Promise<string[]> {
    const data = await this.get(`/api/CtuConNguoi/${prKey}`, { compact_thect: "true" });
    return (data?.danh_sach_seri || []).map((s: PviJson) => String(s.so_seri));
  }

  /** Như bấm "Lưu" trên form SĐBS 0401 của xe máy. SĐBS tạo ra ở trạng thái Chờ duyệt. */
  async createMotorbikeCancellation(mergedPrKey: number, note: string, date: string): Promise<number> {
    const policy = await this.get(`/api/CtuXeCoGioi/${mergedPrKey}`);
    const check = await this.post("/api/PheDuyetCtu/kiem-tra-don-bh-sdbs-huy", { soDonBh: policy.header.so_donbh });
    if (!check.isValid) throw new Error(`${policy.header.so_donbh} không huỷ được: ${check.message}`);
    const json = await this.post(`/api/CtuXeCoGioi/${mergedPrKey}/sdbs`, buildMotorbikeCancellation(policy, note, date));
    return json.data;
  }

  /** Như bấm "Ký" trong thông báo "Ký đơn" của SĐBS xe máy. */
  async signMotorbikeCancellation(sdbsPrKey: number, note: string): Promise<string> {
    const json = await this.post("/api/PheDuyetCtu/update-status", {
      isThuHoi: false,
      prKey: sdbsPrKey,
      trangThai: "02",
      nguoiDuyet: this.user.ma_user,
      ghiChu: note,
      tenNguoiDuyet: this.user.full_name,
      linkView: `${WEB}/insurance/vehicle/motorcycle/${sdbsPrKey}?type=view&sdbsType=04&sdbsDetailType=0401&sdbsMode=sdbs&sdbsOutputType=02`,
    });
    return json.message;
  }
}

/**
 * Body trang gửi khi bấm "Lưu" trên form SĐBS 0401 của xe máy (bắt request ngày 2026-10-23):
 * số liệu của đơn gom đổi dấu. Thử trên CK15569: body dựng ra khớp body thật ở mọi trường trừ mã nội bộ.
 */
export function buildMotorbikeCancellation(policy: PviJson, note: string, date: string) {
  const h = policy.header;
  return {
    header: {
      pr_key: h.pr_key,
      ma_sdbs_ct: "0401",
      ma_sdbs: "04",
      ma_nhloaixe: h.ma_nhloaixe || "",
      rloai_don: "02",
      ngay_dau: dateOnly(h.ngay_dau),
      ngay_cuoi: dateOnly(h.ngay_cuoi),
      time_ngay_dau: h.time_ngay_dau,
      time_ngay_cuoi: h.time_ngay_cuoi,
      ngay_capd: dateOnly(h.ngay_capd),
      ma_daily: h.ma_daily,
      ma_moigioi: h.ma_moigioi || "",
      ma_cbkt: h.ma_cbkt,
      tyle_moigioi: String(h.tyle_moigioi ?? 0),
      ngay_ctu: date,
      tbh_tt: h.tbh_tt ?? false,
      dia_chi: h.dia_chi,
      ngay_ttoan: h.ngay_ttoan,
      up_front: h.up_front ?? null,
      vai_tro_pvi: h.vai_tro_pvi || "",
      kieu_tai_ho: h.kieu_tai_ho || "",
      co_dthu_nhan: h.co_dthu_nhan ?? false,
      khong_phat_sinh: h.khong_phat_sinh ?? false,
      hdon_dientu: h.hdon_dientu ?? 0,
      ten_kh_vat: h.ten_kh_vat || "Bán cho người tiêu dùng",
      dia_chi_vat: h.dia_chi_vat || "Việt Nam",
      is_mst_dn_ngoai: false,
    },
    tab1_chi_tiet_hang_muc: policy.tab1_chi_tiet_hang_muc.map((x: PviJson) => ({
      ma_sp: x.ma_sp,
      so_tienbh: 0,
      so_tienbh_lke: negate(x.so_tienbh),
      nguyen_tep: negate(x.nguyen_tep),
      so_tienp: negate(x.so_tienp),
      // Trang gửi cột "T.suất" của bảng, cột này hiện mức VAT.
      tyle_phi: x.muc_vat,
      nguyen_tev: negate(x.nguyen_tev),
      tien_vat: negate(x.tien_vat),
      ma_dk: "",
      muc_vat: x.muc_vat,
    })),
    tab2_dong_bao_hiem: [],
    tab4_chi_tiet_tinh_phi: [],
    tab5_phan_bo_doanh_thu: policy.tab5_phan_bo_doanh_thu.map((x: PviJson) => ({
      ma_khpbo: x.ma_khpbo,
      ma_kieupbo: x.ma_kieupbo,
      so_tienbh: negate(x.so_tienbh),
      tyle_pbo: x.tyle_pbo,
      nguyen_tep: negate(x.nguyen_tep),
      so_tienp: negate(x.so_tienp),
    })),
    tab6_ky_thu_phi: policy.tab6_ky_thu_phi.map((x: PviJson, i: number) => ({
      stt: i,
      // Chi tiết đơn gom để ngay_hl là ngày thanh toán; form SĐBS gửi ngày đầu.
      ngay_hl: dateOnly(h.ngay_dau),
      tyle_phithu: x.tyle_phithu,
      so_tien: negate(x.so_tien),
      tra_phi: x.tra_phi ?? false,
      ke_toan: x.ke_toan ?? false,
    })),
    tab7_thong_tin_sdbs: {
      pr_key: h.pr_key,
      so_ycau_sdbs: "",
      ngay_ycau_sdbs: date,
      noi_dung_sdbs: note,
      phi_bh_sdbs: "",
      cam_ket_sdbs: "",
      lua_chon_bs: "02",
    },
    chi_tiet_seri: policy.chi_tiet_seri.map((s: PviJson) => ({
      fr_key: 0,
      ma_nlvl: s.ma_nlvl,
      so_seri: Number(s.so_seri),
      seri_sd: false,
      ten_khach: s.ten_khach,
      so_cmnd: s.so_cmnd || "",
      dia_chi: s.dia_chi,
      bien_ksoat: s.bien_ksoat,
      nhan_hieu: s.nhan_hieu,
      ma_loaixe: s.ma_loaixe,
      dung_tich: s.dung_tich || "",
      mau_son: s.mau_son || "",
      nam_sx: s.nam_sx || "",
      nam_sd: s.nam_sd || 0,
      trong_tai: s.trong_tai || "",
      // Đơn gom để trống 2 ô này; form SĐBS tự điền số người của 050202 và nhóm khách.
      so_cngoi: String(s.so_cngoi || (s.chi_tiet_ct || []).find((c: PviJson) => c.ma_sp === "050202")?.so_nguoi || ""),
      ma_loaikh: s.ma_loaikh || s.nhom_khach,
      dien_thoai: s.dien_thoai,
      tong_tien: negate(s.tong_tien),
      ngay_cap_seri: dateOnly(s.ngay_cap_seri),
      ngay_dau_seri: dateOnly(s.ngay_dau_seri),
      ngay_cuoi_seri: dateOnly(s.ngay_cuoi_seri),
      time_ngay_dau: s.time_ngay_dau,
      time_ngay_cuoi: s.time_ngay_cuoi,
      so_may: s.so_may || "",
      so_khung: s.so_khung || "",
      tinh_khach: s.tinh_khach || "",
      ma_dongxe: s.ma_dongxe || "",
      so_the: s.so_the || "",
      nhom_khach: s.nhom_khach,
      dien_giai: "",
      dc_email: s.dc_email,
      giong_lua: false,
      chi_tiet_ct: (s.chi_tiet_ct || []).map((c: PviJson) => ({
        fr_key: c.fr_key,
        ma_sp: c.ma_sp,
        ma_ttep: c.ma_ttep,
        tygia_ht: c.tygia_ht,
        mtn_gtbh_nte: negate(c.mtn_gtbh_nte),
        mtn_gtbh_vnd: negate(c.mtn_gtbh_vnd),
        mtn_gtbh_tsan: negate(c.mtn_gtbh_tsan),
        nguyen_tep: negate(c.nguyen_tep),
        so_tienp: negate(c.so_tienp),
        muc_vat: c.muc_vat,
        nguyen_tev: negate(c.nguyen_tev),
        tien_vat: negate(c.tien_vat),
        muc_mienthuong: c.muc_mienthuong ?? 0,
        ma_muckt: c.ma_muckt || "",
        so_nguoi: c.so_nguoi ?? 0,
        so_tan: c.so_tan ?? 0,
        giatri_tte: c.giatri_tte ?? 0,
      })),
    })),
  };
}
