import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { CODE_LOW_RATIO } from "@/lib/api/bankCatalog";
import type {
  Bank,
  BankForm,
  CodeStatus,
  ReferralCode,
  ReferralCodeForm,
  ReferralCodeSort,
} from "@/lib/api/bankCatalog";
import type { Page } from "@/lib/api/pagination";
import type { PageArgs } from "./pagination";
import type { Channel, ChannelForm } from "@/lib/api/channelCatalog";
import type { Hospital, HospitalForm } from "@/lib/api/hospitalCatalog";
import type {
  Hamlet,
  Province,
  ReferenceProvince,
  ReferenceWard,
  Ward,
} from "@/lib/api/wardCatalog";
import type {
  CatalogItemForm,
  GiftItem,
  InsurancePackage,
  InsurancePackageForm,
  InsurancePackageLeg,
  KpiTarget,
  KpiTargetForm,
  ServiceTypeForm,
  ServiceTypeRow,
} from "@/lib/api/settings";
import { businessMonth, uniqueCode } from "@/lib/format";
import { db, uniqueViolationOf } from "./db/client";
import { recomputeKpiForMonth } from "./kpi";
import {
  banks,
  channels,
  giftItems,
  hospitals,
  insurancePackageLegs,
  insurancePackages,
  hamlets,
  kpiTargets,
  provinces,
  refProvinces,
  refWards,
  referralCodes,
  serviceTypes,
  wards,
} from "./db/schema";

/**
 * Danh mục cấu hình — bản DB của các màn trong nhóm Cấu hình.
 *
 * ⚠️ `channels`, `gift_items`, `insurance_packages` đều có cột `code` BẮT BUỘC
 * mà biểu mẫu không gửi lên (form chỉ có tên). Mã sinh ở đây từ tên, nối số khi
 * đụng — cùng cách `org.ts` sinh mã phòng ban. Mã KHÔNG đổi theo tên về sau:
 * bản ghi nghiệp vụ và module luật theo kỳ đối chiếu bằng mã, đổi mã là cắt đứt
 * mọi thứ đang trỏ vào.
 */

/** Trùng khoá duy nhất → kết quả route đọc được, thay vì 500. */
export type CatalogOutcome<T> =
  | { ok: true; item: T }
  | { ok: false; reason: "code-taken" | "name-taken" };

/**
 * Chạy một lệnh ghi danh mục, đổi lỗi trùng khoá của Postgres thành `ok: false`.
 *
 * Không bắt thì Next trả 500 kèm trang HTML, tầng api không parse nổi JSON nên
 * người dùng chỉ nhận đúng câu "Không lưu được" và không biết mình trùng tên.
 * Gõ tên khác cũng thấy y hệt vì thông báo không nói gì.
 *
 * Phân biệt bằng tên ràng buộc: `*_name_unique` là người dùng gõ trùng tên, còn
 * lại là mã tự sinh đụng nhau khi hai request chạy song song.
 */
async function catalogWrite<T>(run: () => Promise<T>): Promise<CatalogOutcome<T>> {
  try {
    return { ok: true, item: await run() };
  } catch (e) {
    const constraint = uniqueViolationOf(e);
    if (constraint === null) throw e;
    return { ok: false, reason: constraint.includes("name") ? "name-taken" : "code-taken" };
  }
}

/* ── Ngân hàng ────────────────────────────────────────────────────────── */

const toBank = (r: typeof banks.$inferSelect): Bank => ({
  id: r.id,
  code: r.code,
  active: r.active,
  requiredPhotos: r.requiredPhotos,
  accountNumberMethod: r.accountNumberMethod,
  coefficient: Number(r.coefficient),
  countsAsApp: r.countsAsApp,
});

export async function listBanks(): Promise<Bank[]> {
  return (await db.select().from(banks).orderBy(asc(banks.code))).map(toBank);
}

/**
 * Mã ngân hàng do người dùng nhập (khác các danh mục kia) — spec §2.6 liệt kê
 * đích danh 13 mã, đây là danh sách phẳng có thật chứ không phải danh mục tự do.
 *
 * KHÔNG nhận `coefficient`: hệ số điểm hết tác dụng từ 03/08, xem
 * `docs/plan-module-cau-hinh.md`. Dòng mới lấy mặc định 1 của DB.
 */
export async function createBank(form: BankForm): Promise<CatalogOutcome<Bank>> {
  try {
    const [row] = await db
      .insert(banks)
      .values({
        code: form.code,
        requiredPhotos: form.requiredPhotos,
        accountNumberMethod: form.accountNumberMethod,
        countsAsApp: form.countsAsApp,
      })
      .returning();
    return { ok: true, item: toBank(row) };
  } catch (e) {
    if (uniqueViolationOf(e) !== null) return { ok: false, reason: "code-taken" };
    throw e;
  }
}

/**
 * ⚠️ KHÔNG ghi `code`. Mã ngân hàng là DANH TÍNH, không phải cấu hình.
 *
 * Module luật theo kỳ khớp bằng chính chuỗi mã (`TIER_OF`, `REQUIRES_APP`,
 * `CASH_OF` trong `src/rules/`), và file luật đã đóng băng. Đổi `VPa` thành
 * `VPA` là xếp lại hạng cho MỌI tài khoản đã ghi từ trước — điểm KPI và rổ quà
 * của các tháng đã chốt đổi theo, mà không lượt tính lại nào chạy. Nhật ký chỉ
 * ghi "Sửa ngân hàng <mã>" nên sau đó cũng không lần ra đã đổi từ gì sang gì.
 *
 * Spec §2.6 liệt kê đúng năm trường cấu hình sửa được; `mã` không nằm trong đó.
 * Cùng lối với `departments.code` — sinh một lần lúc lập, P-91 chỉ cho đổi TÊN.
 *
 * Mã gửi lên bị bỏ qua trong im lặng, không trả lỗi: ô đã khoá ở giao diện nên
 * đây chỉ là chốt chặn phía máy chủ (AGENTS.md §6), không phải đường người dùng
 * đi tới được.
 */
export async function updateBank(id: string, form: BankForm): Promise<CatalogOutcome<Bank> | null> {
  try {
    const [row] = await db
      .update(banks)
      .set({
        requiredPhotos: form.requiredPhotos,
        accountNumberMethod: form.accountNumberMethod,
        countsAsApp: form.countsAsApp,
      })
      .where(eq(banks.id, id))
      .returning();
    return row ? { ok: true, item: toBank(row) } : null;
  } catch (e) {
    if (uniqueViolationOf(e) !== null) return { ok: false, reason: "code-taken" };
    throw e;
  }
}

export async function setBankActive(id: string, active: boolean): Promise<Bank | null> {
  const [row] = await db.update(banks).set({ active }).where(eq(banks.id, id)).returning();
  return row ? toBank(row) : null;
}

/* ── Mã giới thiệu ────────────────────────────────────────────────────── */

/**
 * `used` = số đã tiêu TRƯỚC khi nhập mã vào hệ thống (`imported_used`, P-62)
 * cộng số tài khoản `done` đang mang mã.
 *
 * Vế thứ hai đọc từ cột lưu sẵn `used_count` do trigger giữ, KHÔNG đếm sống nữa
 * (lý do đầy đủ ở `db/schema.ts`, bảng `referral_codes`). Bản cũ nối cả bảng
 * `bank_accounts` rồi GROUP BY để đếm — mà bộ lọc trạng thái và kiểu sắp theo
 * tiến độ đều suy từ chính con số đó, nên phải gộp xong TOÀN BỘ kho tài khoản
 * mới biết 15 dòng đầu là ai, và câu đếm tổng chạy lại y nguyên phép gộp ấy.
 *
 * `holding` = số tài khoản `creating` đang giữ chỗ mã này. Dòng `creating` sinh
 * ra ở bước 1 của P-20 và chiếm chỗ ngay từ lúc đó (spec §4.5); chỗ quay lại
 * kho khi dòng ấy bị xoá, hoặc chuyển sang `used` khi tài khoản hoàn thành.
 *
 * Trạng thái tính luôn trong SQL chứ không để trình duyệt tự suy. Bắt buộc phải
 * vậy: có lọc theo trạng thái thì máy chủ phải hiểu trạng thái mới cắt đúng
 * trang. Trước đây công thức nằm ở giao diện nên máy chủ cắt trang mù — trang 1
 * lọc xong còn 3 dòng, mà tổng vẫn ghi 240.
 */
const usedExpr = sql<number>`(${referralCodes.importedUsed} + ${referralCodes.usedCount})`;

/**
 * Chỗ THẬT SỰ còn nhận được tài khoản mới: tổng trừ phần đã tiêu và phần đang giữ.
 *
 * Hai người mở dở cùng một mã đã chiếm hai chỗ — ô chọn trừ chúng ra thì con số
 * hiện lên mới là số chỗ người thứ ba nhận được.
 */
const remainingExpr = sql<number>`(${referralCodes.total} - ${referralCodes.importedUsed} - ${referralCodes.usedCount} - ${referralCodes.holdingCount})`;

/**
 * Nhãn trạng thái ở P-61 — đo mã đã TIÊU tới đâu, nên chỉ đọc `used` và `total`.
 * Cùng ngưỡng với `CODE_LOW_RATIO`.
 *
 * Đây là tín hiệu để đi xin ngân hàng cấp mã mới, mà chỗ đang giữ thì nhả lại
 * được bất cứ lúc nào — tính nó vào thì một mã đầy tạm mười phút cũng kêu
 * "Đã đầy". Số chỗ trống thật để mở tài khoản là `remainingExpr` bên trên.
 */
const statusExpr = sql<CodeStatus>`case
  when ${usedExpr} >= ${referralCodes.total} then 'full'
  when ${usedExpr}::float / ${referralCodes.total} >= ${CODE_LOW_RATIO} then 'low'
  else 'available'
end`;

const codeColumns = {
  id: referralCodes.id,
  bankId: referralCodes.bankId,
  bankCode: banks.code,
  code: referralCodes.code,
  total: referralCodes.total,
  used: usedExpr,
  holding: referralCodes.holdingCount,
  status: statusExpr,
  // Cột nullable, nhưng hợp đồng API trả chuỗi — `''` đọc ra "không có link"
  // ở mọi nơi dùng, khỏi phải kiểm `null` riêng.
  openUrl: sql<string>`coalesce(${referralCodes.openUrl}, '')`,
};

/**
 * Vô hiệu ký tự đại diện của `ILIKE` trong chữ người dùng gõ.
 *
 * Không thoát thì gõ `%` ra nguyên cả kho thay vì "không có kết quả", còn `_`
 * lặng lẽ khớp một ký tự bất kỳ nên tìm `ABC_1` ra cả `ABC-1`.
 */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function codeFilters(query: ReferralCodeFilters): SQL | undefined {
  const parts = [
    query.bankId ? eq(referralCodes.bankId, query.bankId) : undefined,
    query.status ? eq(statusExpr, query.status) : undefined,
    // Tìm trên mã lẫn tên ngân hàng: gõ "VPa" ra cả kho của ngân hàng đó, gõ
    // "884" ra đúng mã chứa số ấy.
    query.search
      ? (() => {
          const needle = `%${likeEscape(query.search)}%`;
          return sql`(${referralCodes.code} ilike ${needle} escape '\\' or ${banks.code} ilike ${needle} escape '\\')`;
        })()
      : undefined,
  ].filter(Boolean) as SQL[];
  return parts.length > 0 ? and(...parts) : undefined;
}

export type ReferralCodeFilters = { bankId: string; status: CodeStatus | ""; search: string };

/**
 * MỘT trang mã. Đếm tổng bằng câu thứ hai trên đúng bộ lọc đó — `rows.length`
 * là số dòng của trang, nói ra thì thanh phân trang hiện "1–15 trên 15" ở mọi
 * trang và không ai bấm sang trang sau.
 */
export async function listReferralCodes(
  filters: ReferralCodeFilters,
  page: PageArgs<ReferralCodeSort>,
): Promise<Page<ReferralCode>> {
  const where = codeFilters(filters);
  const direction = page.dir === "asc" ? asc : desc;
  const orderBy = {
    bank: [direction(banks.code), asc(referralCodes.code)],
    code: [direction(referralCodes.code)],
    progress: [direction(sql`${usedExpr}::float / ${referralCodes.total}`), asc(referralCodes.code)],
  }[page.sort];

  const [rows, [totals]] = await Promise.all([
    db
      .select(codeColumns)
      .from(referralCodes)
      .innerJoin(banks, eq(banks.id, referralCodes.bankId))
      .where(where)
      .orderBy(...orderBy)
      .limit(page.limit)
      .offset(page.offset),
    // Phép nối `banks` phải giữ cả ở câu đếm — ô tìm kiếm soi cả tên ngân hàng,
    // bỏ nó đi thì `where` trỏ vào một bảng không có trong câu.
    db
      .select({ value: count() })
      .from(referralCodes)
      .innerJoin(banks, eq(banks.id, referralCodes.bankId))
      .where(where),
  ]);

  return { rows, total: totals?.value ?? 0 };
}

/**
 * Chỉ TÊN mã, cho các ô lọc ở màn báo cáo và xuất Excel.
 *
 * `distinct` vì hai ngân hàng được phép trùng tên mã (khoá duy nhất là bank +
 * code) — để lọt thì ô chọn hiện hai dòng y hệt nhau.
 */
export async function listReferralCodeOptions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: referralCodes.code })
    .from(referralCodes)
    .orderBy(asc(referralCodes.code));
  return rows.map((r) => r.code);
}

/**
 * Mã còn chỗ của một ngân hàng, nhiều chỗ trống lên trước. Ô chọn nên không cắt trang.
 *
 * "Còn chỗ" ở đây trừ CẢ phần đang giữ (`holding`), khác với nhãn trạng thái ở
 * bảng P-61. Đây là danh sách để đi mở tài khoản ngay bây giờ, nên chỗ người
 * khác đang mở dở không phải là chỗ trống.
 */
export async function listOpenReferralCodes(bankId: string): Promise<ReferralCode[]> {
  return db
    .select(codeColumns)
    .from(referralCodes)
    .innerJoin(banks, eq(banks.id, referralCodes.bankId))
    .where(and(eq(referralCodes.bankId, bankId), sql`${remainingExpr} > 0`))
    .orderBy(desc(remainingExpr), asc(referralCodes.code));
}

export async function createReferralCode(
  form: ReferralCodeForm,
): Promise<CatalogOutcome<ReferralCode>> {
  try {
    const [row] = await db
      .insert(referralCodes)
      .values({
        bankId: form.bankId,
        code: form.code,
        total: form.total,
        // Chuỗi rỗng thành NULL: cột này là "có link hay không", và hai cách
        // biểu diễn cho cùng một trạng thái sớm muộn lệch nhau khi lọc.
        openUrl: form.openUrl || null,
      })
      .returning();
    // Đọc lại bằng chính `codeColumns` chứ không tự dựng đối tượng: trạng thái
    // chỉ có một định nghĩa, nằm trong SQL. Dựng tay ở đây là chép công thức
    // lần hai.
    const [item] = await db
      .select(codeColumns)
      .from(referralCodes)
      .innerJoin(banks, eq(banks.id, referralCodes.bankId))
      .where(eq(referralCodes.id, row.id));
    return { ok: true, item };
  } catch (e) {
    if (uniqueViolationOf(e) !== null) return { ok: false, reason: "code-taken" };
    throw e;
  }
}

/* ── Kênh ─────────────────────────────────────────────────────────────── */

const toChannel = (r: typeof channels.$inferSelect): Channel => ({
  id: r.id,
  code: r.code,
  name: r.name,
  inputKind: r.inputKind,
});

export async function listChannels(): Promise<Channel[]> {
  return (await db.select().from(channels).orderBy(asc(channels.name))).map(toChannel);
}

export async function createChannel(form: ChannelForm): Promise<CatalogOutcome<Channel>> {
  return catalogWrite(async () => {
    const taken = new Set((await db.select({ code: channels.code }).from(channels)).map((r) => r.code));
    const [row] = await db
      .insert(channels)
      .values({ code: uniqueCode(form.name, "KENH", taken), name: form.name, inputKind: form.inputKind })
      .returning();
    return toChannel(row);
  });
}

/** Đổi tên KHÔNG đổi mã — bản ghi cũ trỏ vào mã, đổi là cắt đứt chúng. */
export async function updateChannel(
  id: string,
  form: ChannelForm,
): Promise<CatalogOutcome<Channel | null>> {
  return catalogWrite(async () => {
    const [row] = await db
      .update(channels)
      .set({ name: form.name, inputKind: form.inputKind })
      .where(eq(channels.id, id))
      .returning();
    return row ? toChannel(row) : null;
  });
}

/* ── Bệnh viện ────────────────────────────────────────────────────────── */

export async function listHospitals(): Promise<Hospital[]> {
  const rows = await db.select().from(hospitals).orderBy(asc(hospitals.name));
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function createHospital(form: HospitalForm): Promise<CatalogOutcome<Hospital>> {
  return catalogWrite(async () => {
    const [row] = await db.insert(hospitals).values({ name: form.name }).returning();
    return { id: row.id, name: row.name };
  });
}

/* ── Danh mục quà ─────────────────────────────────────────────────────── */

const toGiftItem = (r: typeof giftItems.$inferSelect): GiftItem => ({
  id: r.id,
  name: r.name,
  active: r.active,
});

export async function listGiftItems(): Promise<GiftItem[]> {
  return (await db.select().from(giftItems).orderBy(asc(giftItems.name))).map(toGiftItem);
}

export async function createGiftItem(form: CatalogItemForm): Promise<CatalogOutcome<GiftItem>> {
  return catalogWrite(async () => {
    const taken = new Set((await db.select({ code: giftItems.code }).from(giftItems)).map((r) => r.code));
    const [row] = await db
      .insert(giftItems)
      .values({ code: uniqueCode(form.name, "QUA", taken), name: form.name })
      .returning();
    return toGiftItem(row);
  });
}

export async function setGiftItemActive(id: string, active: boolean): Promise<GiftItem | null> {
  const [row] = await db.update(giftItems).set({ active }).where(eq(giftItems.id, id)).returning();
  return row ? toGiftItem(row) : null;
}

/* ── Gói bảo hiểm ─────────────────────────────────────────────────────── */

/**
 * Gói kèm danh sách leg. Hai câu cho cả bảng rồi gộp ở app — không truy vấn
 * leg theo từng gói (§11.1 cấm N+1).
 */
export async function listInsurancePackages(): Promise<InsurancePackage[]> {
  const [packageRows, legRows] = await Promise.all([
    db.select().from(insurancePackages).orderBy(asc(insurancePackages.name)),
    db.select().from(insurancePackageLegs).orderBy(asc(insurancePackageLegs.ord)),
  ]);

  const legsByPackage = new Map<string, InsurancePackageLeg[]>();
  for (const l of legRows) {
    const list = legsByPackage.get(l.packageId) ?? [];
    list.push({ product: l.product, years: l.years, fee: l.fee });
    legsByPackage.set(l.packageId, list);
  }

  return packageRows.map((p) => ({
    id: p.id,
    name: p.name,
    active: p.active,
    legs: legsByPackage.get(p.id) ?? [],
  }));
}

async function packageWithLegs(id: string): Promise<InsurancePackage | null> {
  return (await listInsurancePackages()).find((p) => p.id === id) ?? null;
}

/** Ghi gói + legs trong MỘT transaction — gói không có leg là gói không dùng được. */
async function writeLegs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  packageId: string,
  legs: InsurancePackageForm["legs"],
): Promise<void> {
  await tx.delete(insurancePackageLegs).where(eq(insurancePackageLegs.packageId, packageId));
  await tx.insert(insurancePackageLegs).values(
    legs.map((leg, i) => ({
      packageId,
      ord: i + 1,
      product: leg.product,
      years: leg.years,
      fee: leg.fee,
    })),
  );
}

export async function createInsurancePackage(
  form: InsurancePackageForm,
): Promise<CatalogOutcome<InsurancePackage>> {
  return catalogWrite(async () => {
    const taken = new Set(
      (await db.select({ code: insurancePackages.code }).from(insurancePackages)).map((r) => r.code),
    );

    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(insurancePackages)
        .values({ code: uniqueCode(form.name, "GOI", taken), name: form.name })
        .returning();
      await writeLegs(tx, row.id, form.legs);
      return row.id;
    });

    return (await packageWithLegs(id))!;
  });
}

/** Đổi tên KHÔNG đổi mã: file luật theo kỳ trỏ vào mã, đổi là gãy. */
export async function updateInsurancePackage(
  id: string,
  form: InsurancePackageForm,
): Promise<CatalogOutcome<InsurancePackage | null>> {
  return catalogWrite(async () => {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(insurancePackages)
        .set({ name: form.name, updatedAt: new Date() })
        .where(eq(insurancePackages.id, id))
        .returning({ id: insurancePackages.id });
      if (!row) return false;
      await writeLegs(tx, id, form.legs);
      return true;
    });

    return updated ? packageWithLegs(id) : null;
  });
}

export async function setInsurancePackageActive(
  id: string,
  active: boolean,
): Promise<InsurancePackage | null> {
  const [row] = await db
    .update(insurancePackages)
    .set({ active })
    .where(eq(insurancePackages.id, id))
    .returning({ id: insurancePackages.id });
  return row ? packageWithLegs(id) : null;
}

/* ── Loại dịch vụ ─────────────────────────────────────────────────────── */

const toServiceType = (r: typeof serviceTypes.$inferSelect): ServiceTypeRow => ({
  id: r.id,
  name: r.name,
  active: r.active,
  coefficient: Number(r.coefficient),
});

export async function listServiceTypes(): Promise<ServiceTypeRow[]> {
  return (await db.select().from(serviceTypes).orderBy(asc(serviceTypes.name))).map(toServiceType);
}

export async function createServiceType(
  form: ServiceTypeForm,
): Promise<CatalogOutcome<ServiceTypeRow>> {
  return catalogWrite(async () => {
    const [row] = await db
      .insert(serviceTypes)
      .values({ name: form.name, coefficient: String(form.coefficient) })
      .returning();
    return toServiceType(row);
  });
}

/**
 * Hệ số loại dịch vụ VẪN còn tác dụng (spec §7.2 — dịch vụ giữ cách cũ), khác
 * hẳn `banks.coefficient` đã bỏ. Nên sửa nó là ĐỔI ĐIỂM KPI THẬT.
 *
 * Vì vậy phải tính lại điểm ngay sau khi ghi. Không gọi thì điểm đã lưu giữ
 * nguyên hệ số cũ, và không có gì báo — người quản trị kéo hệ số từ 1 lên 2 rồi
 * mở bảng nhân sự, thấy số không nhúc nhích, tưởng mình bấm hụt.
 *
 * Chỉ tính lại THÁNG HIỆN TẠI. Tháng cũ giữ nguyên là cố ý: đổi hệ số hôm nay
 * mà chấm lại quá khứ thì báo cáo đã chốt tự viết lại, và người đã nhận lương
 * theo con số cũ bỗng có con số khác.
 *
 * Chạy tuần tự cho vài trăm người nên chậm — chấp nhận được, đây là thao tác
 * cấu hình hiếm khi làm, không phải đường đi hằng ngày.
 */
export async function updateServiceType(
  id: string,
  form: ServiceTypeForm,
): Promise<CatalogOutcome<ServiceTypeRow | null>> {
  return catalogWrite(async () => {
    const [current] = await db
      .select({ coefficient: serviceTypes.coefficient })
      .from(serviceTypes)
      .where(eq(serviceTypes.id, id))
      .limit(1);

    const [row] = await db
      .update(serviceTypes)
      .set({ name: form.name, coefficient: String(form.coefficient) })
      .where(eq(serviceTypes.id, id))
      .returning();
    if (!row) return null;

    // Chỉ tính lại khi HỆ SỐ đổi. Sửa mỗi cái tên mà chạy lại điểm của cả công
    // ty là trả giá cho một thao tác không đụng tới con số nào.
    if (current && Number(current.coefficient) !== form.coefficient)
      await recomputeKpiForMonth(businessMonth());

    return toServiceType(row);
  });
}

export async function setServiceTypeActive(
  id: string,
  active: boolean,
): Promise<ServiceTypeRow | null> {
  const [row] = await db
    .update(serviceTypes)
    .set({ active })
    .where(eq(serviceTypes.id, id))
    .returning();
  return row ? toServiceType(row) : null;
}

/* ── Chỉ tiêu KPI ─────────────────────────────────────────────────────── */

/**
 * Mốc của THÁNG HIỆN TẠI, rơi về mốc chung gần nhất không vượt tháng này.
 *
 * Cùng chuỗi rơi với `people.ts` — hai nơi lệch nhau thì màn cấu hình hiện một
 * số mà bảng KPI chấm theo số khác.
 *
 * Chưa có mốc nào thì trả `null`, KHÔNG bịa 100/7. Bịa thì màn P-83 hiện hai
 * con số trông y như đã lưu, quản trị bấm Lưu là ghi đè bằng số máy tự nghĩ ra
 * — đúng cái mà chốt chặn ở `KpiTargetSection` dựng ra để tránh, chỉ là đi vòng
 * từ phía máy chủ nên chốt đó không bắt được.
 */
export async function getKpiTarget(): Promise<KpiTarget | null> {
  const month = businessMonth();
  const [row] = await db
    .select()
    .from(kpiTargets)
    .where(sql`${kpiTargets.departmentId} is null and ${kpiTargets.yearMonth} <= ${month}`)
    .orderBy(desc(kpiTargets.yearMonth))
    .limit(1);
  return row ? { monthlyPoints: row.monthlyPoints, warnDaysLeft: row.warnDaysLeft } : null;
}

/** Ghi mốc cho THÁNG HIỆN TẠI. Tháng cũ không sửa — sửa là chấm lại quá khứ. */
export async function setKpiTarget(form: KpiTargetForm, updatedBy: string): Promise<KpiTarget> {
  const month = businessMonth();
  const [existing] = await db
    .select({ id: kpiTargets.id })
    .from(kpiTargets)
    .where(sql`${kpiTargets.yearMonth} = ${month} and ${kpiTargets.departmentId} is null`)
    .limit(1);

  const values = {
    yearMonth: month,
    departmentId: null,
    monthlyPoints: form.monthlyPoints,
    warnDaysLeft: form.warnDaysLeft,
    updatedBy,
    updatedAt: new Date(),
  };

  const [row] = existing
    ? await db.update(kpiTargets).set(values).where(eq(kpiTargets.id, existing.id)).returning()
    : await db.insert(kpiTargets).values(values).returning();

  return { monthlyPoints: row.monthlyPoints, warnDaysLeft: row.warnDaysLeft };
}

/* ── Địa bàn: tỉnh · xã/phường · ấp ───────────────────────────────────── */

/**
 * Hai tầng tách bạch (`wardCatalog.ts`):
 *
 * `ref_provinces` / `ref_wards` — bảng THAM CHIẾU, 34 tỉnh + 3.321 xã của cả
 * nước, chỉ đọc, seed một lần. Dùng để CHỌN.
 *
 * `provinces` / `wards` / `hamlets` — địa bàn công ty THẬT sự hoạt động, admin
 * thêm dần từ bảng tham chiếu. Ấp thì không có trong dữ liệu nhà nước nên nhập
 * tay. Ô chọn địa chỉ của khách hàng đọc tầng này, không đọc tầng tham chiếu —
 * đưa cả 3.321 xã ra cho nhân viên tự tìm là chỗ nhập sai.
 */

/** Cả cây địa bàn công ty. Ba câu, gộp ở app — không N+1 theo tỉnh. */
export async function listProvinceTree(): Promise<Province[]> {
  const [provinceRows, wardRows, hamletRows] = await Promise.all([
    db.select().from(provinces).orderBy(asc(provinces.name)),
    db.select().from(wards).orderBy(asc(wards.name)),
    db.select().from(hamlets).orderBy(asc(hamlets.name)),
  ]);

  const hamletsByWard = new Map<string, Hamlet[]>();
  for (const h of hamletRows) {
    const list = hamletsByWard.get(h.wardId) ?? [];
    list.push({ id: h.id, name: h.name });
    hamletsByWard.set(h.wardId, list);
  }

  const wardsByProvince = new Map<string, Ward[]>();
  for (const w of wardRows) {
    const list = wardsByProvince.get(w.provinceId) ?? [];
    list.push({ id: w.id, refId: w.refId, name: w.name, hamlets: hamletsByWard.get(w.id) ?? [] });
    wardsByProvince.set(w.provinceId, list);
  }

  return provinceRows.map((p) => ({
    id: p.id,
    refId: p.refId,
    name: p.name,
    wards: wardsByProvince.get(p.id) ?? [],
  }));
}

/**
 * Đưa một tỉnh từ bảng tham chiếu vào địa bàn công ty. Đã có thì im lặng bỏ qua.
 *
 * Trả về ĐÚNG tỉnh vừa thêm, không trả cả cây — hợp đồng ở `wardCatalog.ts`
 * parse một `Province`, nơi dùng chỉ cần nạp lại khoá `['provinces']`.
 */
export async function addProvince(refId: string): Promise<Province | null> {
  const [ref] = await db.select().from(refProvinces).where(eq(refProvinces.id, refId)).limit(1);
  if (!ref) return null;

  await db
    .insert(provinces)
    .values({ refId: ref.id, name: ref.name })
    .onConflictDoNothing({ target: provinces.refId });

  return provinceByRefId(refId);
}

/** Một tỉnh kèm xã/ấp của nó. */
async function provinceByRefId(refId: string): Promise<Province | null> {
  const [row] = await db.select().from(provinces).where(eq(provinces.refId, refId)).limit(1);
  if (!row) return null;
  return (await listProvinceTree()).find((p) => p.id === row.id) ?? null;
}

async function provinceById(id: string): Promise<Province | null> {
  return (await listProvinceTree()).find((p) => p.id === id) ?? null;
}

/** `provinceId` là uuid tỉnh công ty; `wardRefId` là mã xã ở bảng tham chiếu. */
export async function addWard(provinceId: string, wardRefId: string): Promise<Province | null> {
  const [province] = await db
    .select()
    .from(provinces)
    .where(eq(provinces.id, provinceId))
    .limit(1);
  const [ref] = await db.select().from(refWards).where(eq(refWards.id, wardRefId)).limit(1);
  if (!province || !ref) return null;

  await db
    .insert(wards)
    .values({ provinceId: province.id, refId: ref.id, name: ref.name })
    .onConflictDoNothing({ target: wards.refId });

  return provinceById(province.id);
}

/**
 * Ấp không có trong dữ liệu nhà nước — nhập tay.
 *
 * Trùng tên trong CÙNG một xã thì chặn (chỉ mục `hamlets_ward_name`), và báo ra
 * chứ không nuốt: nuốt thì người dùng nhận "Đã lưu" mà danh sách không đổi, bấm
 * lại vài lần rồi đi hỏi. Trùng tên giữa hai xã khác nhau thì vẫn cho — "Ấp 3"
 * là tên phổ biến, xã nào cũng có.
 */
export async function addHamlet(
  wardId: string,
  name: string,
): Promise<CatalogOutcome<Province | null>> {
  return catalogWrite(async () => {
    const [ward] = await db.select().from(wards).where(eq(wards.id, wardId)).limit(1);
    if (!ward) return null;

    await db.insert(hamlets).values({ wardId, name });
    return provinceById(ward.provinceId);
  });
}

/* ── Tham chiếu hành chính — chỉ đọc ──────────────────────────────────── */

export async function listReferenceProvinces(): Promise<ReferenceProvince[]> {
  return db.select({ id: refProvinces.id, name: refProvinces.name }).from(refProvinces).orderBy(asc(refProvinces.name));
}

/**
 * Xã/phường tham chiếu, lọc theo TỈNH CÔNG TY (uuid trong `provinces`).
 *
 * Nhận uuid chứ không nhận mã tham chiếu: nơi gọi là hộp thoại thêm xã, nó chỉ
 * có đối tượng `Province` của công ty. Bắt nó tự biết mã tham chiếu là rò một
 * chi tiết lưu trữ ra giao diện — và đó chính là chỗ đã sai: truyền uuid vào
 * `ref_wards.province_id` (kiểu text `"01"`) thì không khớp dòng nào, ô tìm xã
 * không ra gì.
 */
export async function listReferenceWards(provinceId: string): Promise<ReferenceWard[]> {
  if (!provinceId) return [];
  const [province] = await db
    .select({ refId: provinces.refId })
    .from(provinces)
    .where(eq(provinces.id, provinceId))
    .limit(1);
  if (!province) return [];

  return db
    .select({ id: refWards.id, name: refWards.name, provinceId: refWards.provinceId })
    .from(refWards)
    .where(eq(refWards.provinceId, province.refId))
    .orderBy(asc(refWards.name));
}
