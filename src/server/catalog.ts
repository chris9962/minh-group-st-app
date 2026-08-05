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
import {
  bankAccounts,
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

/** Mã trùng → `null` để route trả 422 thay vì 500. */
export type CatalogOutcome<T> = { ok: true; item: T } | { ok: false; reason: "code-taken" };

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

export async function updateBank(id: string, form: BankForm): Promise<CatalogOutcome<Bank> | null> {
  try {
    const [row] = await db
      .update(banks)
      .set({
        code: form.code,
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
 * `used` KHÔNG lưu — đếm sống từ `bank_accounts` (`mgst-db-design.md` §4.5 · §9):
 * tài khoản đã `done` đang mang mã, cộng `imported_used` (số đã tiêu TRƯỚC khi
 * nhập mã vào hệ thống).
 *
 * Trạng thái tính luôn trong SQL chứ không để trình duyệt tự suy. Bắt buộc phải
 * vậy: có lọc theo trạng thái thì máy chủ phải hiểu trạng thái mới cắt đúng
 * trang. Trước đây công thức nằm ở giao diện nên máy chủ cắt trang mù — trang 1
 * lọc xong còn 3 dòng, mà tổng vẫn ghi 240.
 *
 * Một câu GROUP BY cho cả kho, không đếm từng mã (§11.1 cấm N+1). Chỉ mục
 * `bank_accounts_referral` (referral_code_id, status) đỡ đúng phép đếm này.
 */
const countedCodes = db
  .select({
    id: referralCodes.id,
    bankId: referralCodes.bankId,
    // Phải đặt bí danh: `banks.code` và `referral_codes.code` trùng tên, để
    // nguyên thì truy vấn con có hai cột `code` và Postgres báo nhập nhằng.
    bankCode: sql<string>`${banks.code}`.as("bank_code"),
    code: referralCodes.code,
    total: referralCodes.total,
    used: sql<number>`(${referralCodes.importedUsed} + count(${bankAccounts.id}) filter (where ${bankAccounts.status} = 'done'))::int`.as(
      "used",
    ),
  })
  .from(referralCodes)
  .innerJoin(banks, eq(banks.id, referralCodes.bankId))
  .leftJoin(bankAccounts, eq(bankAccounts.referralCodeId, referralCodes.id))
  .groupBy(referralCodes.id, banks.code)
  .as("counted");

/** Nhãn trạng thái, suy từ hai số đã đếm. Cùng ngưỡng với `CODE_LOW_RATIO`. */
const statusExpr = sql<CodeStatus>`case
  when ${countedCodes.used} >= ${countedCodes.total} then 'full'
  when ${countedCodes.used}::float / ${countedCodes.total} >= ${CODE_LOW_RATIO} then 'low'
  else 'available'
end`;

function codeFilters(query: ReferralCodeFilters): SQL | undefined {
  const parts = [
    query.bankId ? eq(countedCodes.bankId, query.bankId) : undefined,
    query.status ? eq(statusExpr, query.status) : undefined,
    // Tìm trên mã lẫn tên ngân hàng: gõ "VPa" ra cả kho của ngân hàng đó, gõ
    // "884" ra đúng mã chứa số ấy.
    query.search
      ? sql`(${countedCodes.code} ilike ${`%${query.search}%`} or ${countedCodes.bankCode} ilike ${`%${query.search}%`})`
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
    bank: [direction(countedCodes.bankCode), asc(countedCodes.code)],
    code: [direction(countedCodes.code)],
    progress: [direction(sql`${countedCodes.used}::float / ${countedCodes.total}`), asc(countedCodes.code)],
  }[page.sort];

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: countedCodes.id,
        bankId: countedCodes.bankId,
        bankCode: countedCodes.bankCode,
        code: countedCodes.code,
        total: countedCodes.total,
        used: countedCodes.used,
        status: statusExpr,
      })
      .from(countedCodes)
      .where(where)
      .orderBy(...orderBy)
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: count() }).from(countedCodes).where(where),
  ]);

  return { rows, total: totals?.value ?? 0 };
}

/**
 * Chỉ TÊN mã, cho các ô lọc ở màn báo cáo và xuất Excel.
 *
 * Không đụng `countedCodes`: ô lọc chỉ cần chuỗi để hiện, đếm `used` cho từng mã
 * là trả tiền cho phép gộp trên cả bảng tài khoản rồi vứt kết quả đi. `distinct`
 * vì hai ngân hàng được phép trùng tên mã (khoá duy nhất là bank + code) — để
 * lọt thì ô chọn hiện hai dòng y hệt nhau.
 */
export async function listReferralCodeOptions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: referralCodes.code })
    .from(referralCodes)
    .orderBy(asc(referralCodes.code));
  return rows.map((r) => r.code);
}

/** Mã còn chỗ của một ngân hàng, nhiều chỗ trống lên trước. Ô chọn nên không cắt trang. */
export async function listOpenReferralCodes(bankId: string): Promise<ReferralCode[]> {
  return db
    .select({
      id: countedCodes.id,
      bankId: countedCodes.bankId,
      bankCode: countedCodes.bankCode,
      code: countedCodes.code,
      total: countedCodes.total,
      used: countedCodes.used,
      status: statusExpr,
    })
    .from(countedCodes)
    .where(and(eq(countedCodes.bankId, bankId), sql`${countedCodes.used} < ${countedCodes.total}`))
    .orderBy(desc(sql`${countedCodes.total} - ${countedCodes.used}`), asc(countedCodes.code));
}

export async function createReferralCode(
  form: ReferralCodeForm,
): Promise<CatalogOutcome<ReferralCode>> {
  try {
    const [row] = await db
      .insert(referralCodes)
      .values({ bankId: form.bankId, code: form.code, total: form.total })
      .returning();
    // Đọc lại qua `countedCodes` chứ không tự dựng đối tượng: trạng thái chỉ có
    // một định nghĩa, nằm trong SQL. Dựng tay ở đây là chép công thức lần hai.
    const [item] = await db
      .select({
        id: countedCodes.id,
        bankId: countedCodes.bankId,
        bankCode: countedCodes.bankCode,
        code: countedCodes.code,
        total: countedCodes.total,
        used: countedCodes.used,
        status: statusExpr,
      })
      .from(countedCodes)
      .where(eq(countedCodes.id, row.id));
    return { ok: true, item };
  } catch (e) {
    if (uniqueViolationOf(e) !== null) return { ok: false, reason: "code-taken" };
    throw e;
  }
}

/* ── Kênh ─────────────────────────────────────────────────────────────── */

const toChannel = (r: typeof channels.$inferSelect): Channel => ({
  id: r.id,
  name: r.name,
  inputKind: r.inputKind,
});

export async function listChannels(): Promise<Channel[]> {
  return (await db.select().from(channels).orderBy(asc(channels.name))).map(toChannel);
}

export async function createChannel(form: ChannelForm): Promise<Channel> {
  const taken = new Set((await db.select({ code: channels.code }).from(channels)).map((r) => r.code));
  const [row] = await db
    .insert(channels)
    .values({ code: uniqueCode(form.name, "KENH", taken), name: form.name, inputKind: form.inputKind })
    .returning();
  return toChannel(row);
}

/** Đổi tên KHÔNG đổi mã — bản ghi cũ trỏ vào mã, đổi là cắt đứt chúng. */
export async function updateChannel(id: string, form: ChannelForm): Promise<Channel | null> {
  const [row] = await db
    .update(channels)
    .set({ name: form.name, inputKind: form.inputKind })
    .where(eq(channels.id, id))
    .returning();
  return row ? toChannel(row) : null;
}

/* ── Bệnh viện ────────────────────────────────────────────────────────── */

export async function listHospitals(): Promise<Hospital[]> {
  const rows = await db.select().from(hospitals).orderBy(asc(hospitals.name));
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function createHospital(form: HospitalForm): Promise<Hospital> {
  const [row] = await db.insert(hospitals).values({ name: form.name }).returning();
  return { id: row.id, name: row.name };
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

export async function createGiftItem(form: CatalogItemForm): Promise<GiftItem> {
  const taken = new Set((await db.select({ code: giftItems.code }).from(giftItems)).map((r) => r.code));
  const [row] = await db
    .insert(giftItems)
    .values({ code: uniqueCode(form.name, "QUA", taken), name: form.name })
    .returning();
  return toGiftItem(row);
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
): Promise<InsurancePackage> {
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
}

/** Đổi tên KHÔNG đổi mã: file luật theo kỳ trỏ vào mã, đổi là gãy. */
export async function updateInsurancePackage(
  id: string,
  form: InsurancePackageForm,
): Promise<InsurancePackage | null> {
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

export async function createServiceType(form: ServiceTypeForm): Promise<ServiceTypeRow> {
  const [row] = await db
    .insert(serviceTypes)
    .values({ name: form.name, coefficient: String(form.coefficient) })
    .returning();
  return toServiceType(row);
}

/**
 * Hệ số loại dịch vụ VẪN còn tác dụng (spec §7.2 — dịch vụ giữ cách cũ), khác
 * hẳn `banks.coefficient` đã bỏ. Nên sửa nó là đổi điểm KPI thật.
 *
 * TODO(KPI, chờ module dịch vụ): sau khi sửa phải gọi `recomputeKpiForMonth`
 * cho tháng hiện tại, không thì điểm đã lưu giữ nguyên hệ số cũ. Chưa gọi ở đây
 * vì bảng `services` còn rỗng — không có gì để tính lại.
 */
export async function updateServiceType(
  id: string,
  form: ServiceTypeForm,
): Promise<ServiceTypeRow | null> {
  const [row] = await db
    .update(serviceTypes)
    .set({ name: form.name, coefficient: String(form.coefficient) })
    .where(eq(serviceTypes.id, id))
    .returning();
  return row ? toServiceType(row) : null;
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
 */
export async function getKpiTarget(): Promise<KpiTarget> {
  const month = businessMonth();
  const rows = await db.select().from(kpiTargets);
  const exact = rows.find((r) => r.departmentId === null && r.yearMonth === month);
  const latest = rows
    .filter((r) => r.departmentId === null && r.yearMonth <= month)
    .sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1))[0];
  const row = exact ?? latest;
  return { monthlyPoints: row?.monthlyPoints ?? 100, warnDaysLeft: row?.warnDaysLeft ?? 7 };
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

/** Ấp không có trong dữ liệu nhà nước — nhập tay, nên có thể trùng tên trong cùng xã. */
export async function addHamlet(wardId: string, name: string): Promise<Province | null> {
  const [ward] = await db.select().from(wards).where(eq(wards.id, wardId)).limit(1);
  if (!ward) return null;

  await db.insert(hamlets).values({ wardId, name }).onConflictDoNothing();
  return provinceById(ward.provinceId);
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
